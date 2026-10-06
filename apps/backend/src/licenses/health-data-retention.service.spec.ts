import { Test, TestingModule } from "@nestjs/testing";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { HealthDataRetentionService } from "./health-data-retention.service";

describe("HealthDataRetentionService", () => {
  let service: HealthDataRetentionService;

  const mockPrisma = {
    licenseRenewalDocument: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockCleaner = {
    deleteFiles: jest.fn(),
  };

  /** Déposé il y a longtemps, sans date OCR : dû depuis des mois. */
  const overdue = {
    id: "doc-old",
    filePath: "blob-old",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    ocrData: null,
  };

  /** Candidat par son âge, mais émis récemment : pas encore dû. */
  const notYetDue = {
    id: "doc-recent-cert",
    filePath: "blob-recent",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ocrData: { date: new Date().toISOString() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({
      count: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthDataRetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RenewalDocumentFileCleaner, useValue: mockCleaner },
      ],
    }).compile();

    service = module.get(HealthDataRetentionService);
  });

  it("ne ramène que les certificats médicaux, bornés et triés du plus ancien", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([]);

    await service.purgeExpiredHealthData();

    const [args] = mockPrisma.licenseRenewalDocument.findMany.mock.calls[0] as [
      {
        where: { type: unknown; createdAt: { lt: Date } };
        orderBy: unknown;
        take: number;
      },
    ];
    expect(args.where.type).toBe(
      LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    expect(args.where.createdAt.lt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    // Jamais de findMany non borné (CLAUDE.md).
    expect(args.take).toBeGreaterThan(0);
  });

  it("supprime le fichier PUIS la ligne d'un document échu", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([overdue]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-old"]));

    const report = await service.purgeExpiredHealthData();

    expect(mockCleaner.deleteFiles).toHaveBeenCalledWith(
      ["blob-old"],
      "retention-purge",
    );
    expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["doc-old"] } },
    });
    expect(report).toEqual({ scanned: 1, due: 1, purged: 1, retryLater: 0 });
  });

  // Le filtre SQL est volontairement large : l'échéance exacte dépend de la date
  // d'émission, que seul le code sait lire dans `ocrData`.
  it("épargne un candidat dont le certificat n'est pas encore échu", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([notYetDue]);

    const report = await service.purgeExpiredHealthData();

    expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    expect(report).toEqual({ scanned: 1, due: 0, purged: 0, retryLater: 0 });
  });

  it("trie les échus des non-échus dans un même lot", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([
      overdue,
      notYetDue,
    ]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-old"]));

    const report = await service.purgeExpiredHealthData();

    expect(mockCleaner.deleteFiles).toHaveBeenCalledWith(
      ["blob-old"],
      "retention-purge",
    );
    expect(report).toEqual({ scanned: 2, due: 1, purged: 1, retryLater: 0 });
  });

  /**
   * LE comportement qui distingue cette purge d'un effacement ordinaire : la
   * ligne est le seul pointeur vers le blob. L'effacer alors que le fichier a
   * résisté abandonnerait une donnée de santé que plus rien ne désigne.
   */
  it("conserve la ligne quand le fichier n'a pas pu être supprimé", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([overdue]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set<string>());

    const report = await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    expect(report).toEqual({ scanned: 1, due: 1, purged: 0, retryLater: 1 });
  });

  it("ne supprime que les lignes dont le fichier est réellement parti", async () => {
    const second = { ...overdue, id: "doc-old-2", filePath: "blob-old-2" };
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([
      overdue,
      second,
    ]);
    mockCleaner.deleteFiles.mockResolvedValue(new Set(["blob-old-2"]));

    const report = await service.purgeExpiredHealthData();

    expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["doc-old-2"] } },
    });
    expect(report).toEqual({ scanned: 2, due: 2, purged: 1, retryLater: 1 });
  });

  it("ne touche à rien quand aucun candidat n'est remonté", async () => {
    mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([]);

    const report = await service.purgeExpiredHealthData();

    expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
    expect(mockPrisma.licenseRenewalDocument.deleteMany).not.toHaveBeenCalled();
    expect(report).toEqual({ scanned: 0, due: 0, purged: 0, retryLater: 0 });
  });

  describe("onModuleInit", () => {
    // Sur un backend à minReplicas=0, le démarrage à froid est le seul instant
    // dont on est certain : un cron à heure fixe pourrait ne jamais tomber
    // pendant une fenêtre d'éveil.
    it("lance une passe au démarrage", () => {
      mockPrisma.licenseRenewalDocument.findMany.mockResolvedValue([]);

      service.onModuleInit();

      expect(mockPrisma.licenseRenewalDocument.findMany).toHaveBeenCalled();
    });

    it("ne fait pas échouer le démarrage si la purge casse", async () => {
      mockPrisma.licenseRenewalDocument.findMany.mockRejectedValue(
        new Error("DB down"),
      );

      expect(() => service.onModuleInit()).not.toThrow();
      // Laisse le rejet se propager jusqu'au `catch` : sans ça le test sortirait
      // avant que le chemin d'erreur ne s'exécute, et une exception non
      // rattrapée au démarrage passerait inaperçue.
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
