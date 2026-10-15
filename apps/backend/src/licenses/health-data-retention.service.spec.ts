import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { HealthDataRetentionService } from "./health-data-retention.service";

const NOW = new Date("2027-06-01T12:00:00Z");

describe("HealthDataRetentionService", () => {
  let service: HealthDataRetentionService;

  const mockPrisma = {
    licenseRenewalDocument: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    licenseRenewalRequest: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockCleaner = { deleteFiles: jest.fn() };
  const mockBlobStorage = { isEnabled: jest.fn() };
  const mockHealthAccess = { recordOp: jest.fn(), purgeExpired: jest.fn() };

  const due = {
    id: "doc-1",
    filePath: "blob-1",
    requestId: "req-1",
    request: { userId: "user-1" },
  };

  /** `findMany` sert d'abord le backfill, puis les documents échus. */
  const whenFindMany = (undated: unknown[], dueDocs: unknown[]) => {
    mockPrisma.licenseRenewalDocument.findMany
      .mockResolvedValueOnce(undated)
      .mockResolvedValueOnce(dueDocs);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    mockBlobStorage.isEnabled.mockReturnValue(true);
    mockPrisma.licenseRenewalDocument.updateMany.mockResolvedValue({
      count: 1,
    });
    mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({
      count: 1,
    });
    mockPrisma.licenseRenewalRequest.updateMany.mockResolvedValue({
      count: 0,
    });
    mockPrisma.$transaction.mockResolvedValue([]);
    mockHealthAccess.recordOp.mockReturnValue("health-access-op");
    mockHealthAccess.purgeExpired.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthDataRetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RenewalDocumentFileCleaner, useValue: mockCleaner },
        { provide: BlobStorageService, useValue: mockBlobStorage },
        { provide: HealthDataAccessLogService, useValue: mockHealthAccess },
      ],
    }).compile();

    service = module.get(HealthDataRetentionService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Sans stockage utilisable, la purge ne peut pas prouver qu'un fichier est
   * parti. Avancer effacerait les lignes et laisserait les certificats dans le
   * conteneur, sans plus aucun pointeur — l'orphelin exact que la séquence
   * « fichier d'abord » prétend empêcher.
   */
  it("abandonne le passage quand le stockage blob n'est pas configuré", async () => {
    mockBlobStorage.isEnabled.mockReturnValue(false);

    const report = await service.purgeExpiredHealthData();

    expect(report.skipped).toBe(true);
    expect(mockPrisma.licenseRenewalDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
  });

  /**
   * LA requête qui porte l'engagement. Elle est assertée EN VALEUR : avec une
   * borne approximative, la purge ne ramènerait jamais les bons documents et
   * l'absence de suppression passerait pour un fonctionnement normal.
   */
  it("filtre exactement sur l'échéance stockée, triée et bornée", async () => {
    whenFindMany([], []);

    await service.purgeExpiredHealthData();

    const dueQuery = mockPrisma.licenseRenewalDocument.findMany.mock
      .calls[1][0] as {
      where: {
        type: unknown;
        purgeDueAt: { lte: Date };
        request: unknown;
      };
      orderBy: unknown;
      take: number;
    };
    expect(dueQuery.where.type).toBe(
      LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    expect(dueQuery.where.purgeDueAt).toEqual({ lte: NOW });
    // #271 : une demande en attente de décision garde son certificat.
    expect(dueQuery.where.request).toEqual({
      status: { not: LicenseRenewalStatus.PENDING },
    });
    expect(dueQuery.orderBy).toEqual({ purgeDueAt: "asc" });
    expect(dueQuery.take).toBeGreaterThan(0);
    // Petit lot : les suppressions de blob partent en parallèle derrière un
    // disjoncteur PARTAGÉ avec le streaming musical.
    expect(dueQuery.take).toBeLessThanOrEqual(50);
  });

  /**
   * #266 : le commentaire de l'administrateur peut décrire le certificat ; il
   * part avec le document, avant le stockage externe, même si le fichier
   * résiste.
   */
  it("efface le commentaire de modération des demandes concernées", async () => {
    whenFindMany(
      [],
      [due, { id: "doc-2", filePath: "blob-2", requestId: "req-1" }],
    );
    mockCleaner.deleteFiles.mockResolvedValue(new Set());

    await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["req-1"] }, reviewComment: { not: null } },
      data: { reviewComment: null },
    });
    // The health-data reason code is neutralised with the certificate.
    expect(mockPrisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["req-1"] }, rejectionReason: "MEDICAL_RESTRICTION" },
      data: { rejectionReason: "OTHER" },
    });
    expect(
      mockPrisma.licenseRenewalRequest.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(mockCleaner.deleteFiles.mock.invocationCallOrder[0]);
  });

  it("efface les données extraites PUIS le fichier PUIS la ligne", async () => {
    whenFindMany([], [due]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-1"]));

    const report = await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalDocument.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["doc-1"] } },
      data: { ocrData: Prisma.DbNull },
    });
    expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["doc-1"] } },
    });
    // L'ordre est la garantie : les données de santé extraites partent avant
    // qu'on dépende d'un stockage externe, la ligne part après le fichier.
    const strip =
      mockPrisma.licenseRenewalDocument.updateMany.mock.invocationCallOrder[0];
    const file = mockCleaner.deleteFiles.mock.invocationCallOrder[0];
    const row =
      mockPrisma.licenseRenewalDocument.deleteMany.mock.invocationCallOrder[0];
    expect(strip).toBeLessThan(file);
    expect(file).toBeLessThan(row);
    expect(report.purged).toBe(1);
  });

  // #63 : chaque certificat purgé laisse une trace (traitement automatique,
  // sans auteur), validée avec la suppression de la ligne.
  it("trace la suppression de chaque certificat purgé, dans la même transaction", async () => {
    whenFindMany([], [due]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-1"]));
    mockPrisma.licenseRenewalDocument.deleteMany.mockReturnValue("delete-op");

    await service.purgeExpiredHealthData();

    expect(mockHealthAccess.recordOp).toHaveBeenCalledWith([
      {
        subjectUserId: "user-1",
        actorUserId: null,
        actorRole: "SYSTEM",
        action: "DELETE",
        resourceType: "MEDICAL_CERTIFICATE",
        resourceId: "doc-1",
        route: "job:health-data-retention",
      },
    ]);
    expect(mockPrisma.$transaction).toHaveBeenCalledWith([
      "delete-op",
      "health-access-op",
    ]);
  });

  /**
   * `ocrData` contient `rawText` : 500 caractères bruts du certificat. Il doit
   * disparaître à l'heure dite même si le fichier résiste, sinon une panne de
   * stockage le conserverait indéfiniment.
   */
  it("efface les données extraites même quand le fichier résiste", async () => {
    whenFindMany([], [due]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set<string>());

    const report = await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalDocument.updateMany).toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    // Rien de supprimé, rien de tracé : le passage suivant le fera.
    expect(mockHealthAccess.recordOp).not.toHaveBeenCalled();
    expect(report).toMatchObject({ stripped: 1, purged: 0, retryLater: 1 });
  });

  it("ne supprime que les lignes dont le fichier est réellement parti", async () => {
    whenFindMany(
      [],
      [
        due,
        {
          id: "doc-2",
          filePath: "blob-2",
          requestId: "req-2",
          request: { userId: "user-2" },
        },
      ],
    );
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-2"]));

    const report = await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["doc-2"] } },
    });
    expect(report).toMatchObject({ due: 2, purged: 1, retryLater: 1 });
    expect(mockHealthAccess.recordOp).toHaveBeenCalledWith([
      expect.objectContaining({ resourceId: "doc-2", subjectUserId: "user-2" }),
    ]);
  });

  it("ne touche à rien quand aucun document n'est échu", async () => {
    whenFindMany([], []);

    const report = await service.purgeExpiredHealthData();

    expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    expect(report.due).toBe(0);
  });

  describe("datation des lignes antérieures", () => {
    it("calcule l'échéance des documents qui n'en ont pas", async () => {
      whenFindMany(
        [
          {
            id: "legacy-1",
            createdAt: new Date("2026-03-10T00:00:00Z"),
            ocrData: null,
          },
        ],
        [],
      );

      const report = await service.purgeExpiredHealthData();

      expect(report.dated).toBe(1);
      const [args] = mockPrisma.licenseRenewalDocument.update.mock.calls[0] as [
        { where: { id: string }; data: { purgeDueAt: Date } },
      ];
      expect(args.where.id).toBe("legacy-1");
      // Sans date d'émission : dépôt + 12 mois.
      expect(args.data.purgeDueAt.toISOString().slice(0, 10)).toBe(
        "2027-03-10",
      );
    });

    it("ne cherche que des certificats médicaux non datés", async () => {
      whenFindMany([], []);

      await service.purgeExpiredHealthData();

      const [args] = mockPrisma.licenseRenewalDocument.findMany.mock
        .calls[0] as [
        { where: { type: unknown; purgeDueAt: null }; take: number },
      ];
      expect(args.where.type).toBe(
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      );
      expect(args.where.purgeDueAt).toBeNull();
      expect(args.take).toBeGreaterThan(0);
    });
  });

  describe("déclenchement", () => {
    // Sur un backend à minReplicas=0, le démarrage à froid est le seul instant
    // dont on soit certain : un cron à heure fixe pourrait ne jamais tomber
    // pendant une fenêtre d'éveil.
    it("lance une passe au démarrage", () => {
      whenFindMany([], []);

      service.onModuleInit();

      expect(mockBlobStorage.isEnabled).toHaveBeenCalled();
    });

    /**
     * Sans l'enveloppe, le rejet finissait dans le `console.error` de la
     * librairie cron : ni logger Nest, ni Sentry. Un contrôle de conformité
     * pouvait échouer toutes les heures sans que personne ne le voie.
     */
    it("journalise l'échec d'une passe au lieu de le perdre", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => {});
      mockPrisma.licenseRenewalDocument.findMany.mockRejectedValue(
        new Error("DB down"),
      );

      await service.handleCron();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("Health data retention pass failed"),
      );
      logged.mockRestore();
    });

    // « zéro suppression » et « la purge ne tourne plus » doivent être
    // distinguables depuis les journaux.
    describe("rétention du journal des accès (#63)", () => {
      it("purge le journal à chaque passage, même sans stockage blob", async () => {
        mockBlobStorage.isEnabled.mockReturnValue(false);
        mockHealthAccess.purgeExpired.mockResolvedValue(3);
        const logged = jest
          .spyOn(Logger.prototype, "log")
          .mockImplementation(() => {});
        const warned = jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => {});

        await service.handleCron();

        expect(mockHealthAccess.purgeExpired).toHaveBeenCalledTimes(1);
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining("3 row(s) purged"),
        );
        logged.mockRestore();
        warned.mockRestore();
      });

      it("un échec de la purge du journal est journalisé, pas propagé", async () => {
        whenFindMany([], []);
        mockHealthAccess.purgeExpired.mockRejectedValue(new Error("DB down"));
        const errored = jest
          .spyOn(Logger.prototype, "error")
          .mockImplementation(() => {});
        const logged = jest
          .spyOn(Logger.prototype, "log")
          .mockImplementation(() => {});

        await expect(service.handleCron()).resolves.toBeUndefined();

        expect(errored).toHaveBeenCalledWith(
          expect.stringContaining("Health data access log purge failed"),
        );
        errored.mockRestore();
        logged.mockRestore();
      });
    });

    it("journalise même un passage sans rien à faire", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => {});
      whenFindMany([], []);

      await service.handleCron();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("Health data retention"),
      );
      logged.mockRestore();
    });
  });
});
