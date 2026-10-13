import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { OcrService } from "../utils/ocr.service";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicenseRenewalNotificationService } from "./license-renewal-notification.service";

/** Buffer factice représentant un document uploadé en mémoire. */
const FILE_BUFFER = Buffer.from("fake-file-bytes");
/** Nom de blob factice généré par le contrôleur. */
const BLOB_NAME = "document-123.jpg";

describe("LicenseRenewalService", () => {
  let service: LicenseRenewalService;

  interface MockPrisma {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    license: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    licenseRenewalRequest: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    licenseRenewalDocument: {
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
  }

  interface MockOcr {
    extractLicenseInfo: jest.Mock;
    extractMedicalCertificateInfo: jest.Mock;
  }

  const mockPrisma: MockPrisma = {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(),
    license: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    licenseRenewalRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    licenseRenewalDocument: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockOcr: MockOcr = {
    extractLicenseInfo: jest.fn(),
    extractMedicalCertificateInfo: jest.fn(),
  };

  interface MockBlob {
    isEnabled: jest.Mock;
    uploadBuffer: jest.Mock;
    getUploadsContainer: jest.Mock;
  }

  const mockBlob: MockBlob = {
    isEnabled: jest.fn().mockReturnValue(true),
    uploadBuffer: jest
      .fn()
      .mockResolvedValue("https://blob.example.com/uploads/document-123.jpg"),
    getUploadsContainer: jest.fn().mockReturnValue("uploads"),
  };

  const mockCleaner = { deleteFiles: jest.fn() };
  const mockNotifications = { sendToUsers: jest.fn(), sendToUser: jest.fn() };

  /** Lets the fire-and-forget notification settle. */
  const flushNotifications = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseRenewalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: mockOcr },
        { provide: BlobStorageService, useValue: mockBlob },
        { provide: RenewalDocumentFileCleaner, useValue: mockCleaner },
        // The real notifier, over a mocked NotificationsService: the
        // fire-and-forget contract is part of what is tested here.
        LicenseRenewalNotificationService,
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<LicenseRenewalService>(LicenseRenewalService);
    jest.clearAllMocks();
    mockBlob.isEnabled.mockReturnValue(true);
    mockBlob.getUploadsContainer.mockReturnValue("uploads");
    // Array form (document replacement) and interactive form (approval).
    mockPrisma.$transaction.mockImplementation(
      (ops: Promise<unknown>[] | ((tx: MockPrisma) => Promise<unknown>)) =>
        typeof ops === "function" ? ops(mockPrisma) : Promise.all(ops),
    );
    mockPrisma.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.licenseRenewalRequest.count.mockResolvedValue(0);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue({
      id: "req-1",
      status: LicenseRenewalStatus.APPROVED,
      documents: [],
    });
    mockCleaner.deleteFiles.mockResolvedValue(new Set());
  });

  describe("startRenewalRequest", () => {
    it("should return existing DRAFT request if one exists", async () => {
      const existing = {
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);

      const result = await service.startRenewalRequest("user-1");

      expect(result).toEqual(existing);
      expect(mockPrisma.licenseRenewalRequest.create).not.toHaveBeenCalled();
    });

    it("returns the PENDING request instead of opening a draft (#271)", async () => {
      const pending = {
        id: "req-pending",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValueOnce(pending);

      const result = await service.startRenewalRequest("user-1");

      expect(result).toEqual(pending);
      // Looked for first, and a draft is neither looked for nor created.
      expect(mockPrisma.licenseRenewalRequest.findFirst).toHaveBeenCalledTimes(
        1,
      );
      expect(mockPrisma.licenseRenewalRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", status: LicenseRenewalStatus.PENDING },
          orderBy: { createdAt: "asc" },
        }),
      );
      expect(mockPrisma.licenseRenewalRequest.create).not.toHaveBeenCalled();
    });

    it("locks the user's row before reading, inside one transaction (#271)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.licenseRenewalRequest.create.mockResolvedValue({
        id: "req-2",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });

      await service.startRenewalRequest("user-1");

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
      );
      const [sql] = mockPrisma.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(sql.sql).toContain('FROM "User"');
      expect(sql.sql).toContain("FOR NO KEY UPDATE");
      expect(sql.values).toEqual(["user-1"]);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.licenseRenewalRequest.findFirst.mock.invocationCallOrder[0],
      );
    });

    it("answers 404, and reads nothing, when the user row cannot be locked (deleted account)", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.startRenewalRequest("user-1")).rejects.toThrow(
        new NotFoundException("Utilisateur non trouvé"),
      );
      expect(mockPrisma.licenseRenewalRequest.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.licenseRenewalRequest.create).not.toHaveBeenCalled();
    });

    it("should create a new DRAFT request if none exists", async () => {
      const newRequest = {
        id: "req-2",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.licenseRenewalRequest.create.mockResolvedValue(newRequest);

      const result = await service.startRenewalRequest("user-1");

      expect(result).toEqual(newRequest);
      expect(mockPrisma.licenseRenewalRequest.create).toHaveBeenCalled();
    });
  });

  describe("getMyRenewalRequest", () => {
    it("should return the most recent request when none is PENDING", async () => {
      const existingRequest = {
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingRequest);

      const result = await service.getMyRenewalRequest("user-1");

      expect(result).toEqual(existingRequest);
      expect(
        mockPrisma.licenseRenewalRequest.findFirst,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("returns the oldest PENDING request before any newer one (#271)", async () => {
      const pending = {
        id: "req-pending",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValueOnce(pending);

      const result = await service.getMyRenewalRequest("user-1");

      expect(result).toEqual(pending);
      expect(mockPrisma.licenseRenewalRequest.findFirst).toHaveBeenCalledTimes(
        1,
      );
      expect(mockPrisma.licenseRenewalRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", status: LicenseRenewalStatus.PENDING },
          orderBy: { createdAt: "asc" },
        }),
      );
    });

    it("should return null if no request exists", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      const result = await service.getMyRenewalRequest("user-1");

      expect(result).toBeNull();
    });

    it("selects the decision the licensee is shown (#268)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      await service.getMyRenewalRequest("user-1");

      const { select } = mockPrisma.licenseRenewalRequest.findFirst.mock
        .calls[0][0] as { select: Record<string, unknown> };
      expect(select).toEqual(
        expect.objectContaining({
          submittedAt: true,
          rejectionReason: true,
          reviewComment: true,
        }),
      );
      // Who decided stays internal: the licensee hears from the federation.
      expect(select).not.toHaveProperty("reviewedBy");
      expect(select).not.toHaveProperty("reviewedById");
    });
  });

  describe("uploadRenewalDocument", () => {
    it("should throw NotFoundException if request not found", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadRenewalDocument(
          "user-1",
          "req-1",
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          FILE_BUFFER,
          BLOB_NAME,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if request is not DRAFT", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      });

      await expect(
        service.uploadRenewalDocument(
          "user-1",
          "req-1",
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          FILE_BUFFER,
          BLOB_NAME,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ["says unfit", { isApte: false }, { isApte: false }],
      // An unread fitness is stored as no reading at all (whitelist, #224).
      ["leaves fitness unread", { isApte: null }, {}],
      [
        "is older than the federation allows",
        { isApte: true, date: "2001-02-03" },
        { isApte: true, date: "2001-02-03" },
      ],
    ])(
      "archives a medical certificate whose OCR %s, with its hints and purge date (#271)",
      async (_label, ocr, stored) => {
        mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
          status: LicenseRenewalStatus.DRAFT,
          documents: [],
        });
        mockOcr.extractMedicalCertificateInfo.mockResolvedValue(ocr);
        mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
        mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
        const draft = {
          id: "req-1",
          status: LicenseRenewalStatus.DRAFT,
          documents: [],
        };
        mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
          draft,
        );

        await expect(
          service.uploadRenewalDocument(
            "user-1",
            "req-1",
            LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            FILE_BUFFER,
            BLOB_NAME,
          ),
        ).resolves.toEqual(draft);

        expect(mockBlob.uploadBuffer).toHaveBeenCalledWith(
          FILE_BUFFER,
          BLOB_NAME,
          "uploads",
        );
        const [createArgs] = mockPrisma.licenseRenewalDocument.create.mock
          .calls[0] as [
          { data: { ocrData: unknown; purgeDueAt: unknown; filePath: string } },
        ];
        // The reading is kept as a hint for the administrator who decides.
        expect(createArgs.data.ocrData).toEqual(stored);
        expect(createArgs.data.filePath).toBe(BLOB_NAME);
        expect(createArgs.data.purgeDueAt).toBeInstanceOf(Date);
      },
    );

    it("should upload LICENSE_CERTIFICATE and return updated request", async () => {
      const updatedRequest = {
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: "FFD-123",
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        updatedRequest,
      );

      const result = await service.uploadRenewalDocument(
        "user-1",
        "req-1",
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        FILE_BUFFER,
        BLOB_NAME,
      );

      expect(result).toEqual(updatedRequest);
      // OCR reads the in-memory buffer directly.
      expect(mockOcr.extractLicenseInfo).toHaveBeenCalledWith(FILE_BUFFER);
      // The buffer is archived to Blob (uploads container) before DB write.
      expect(mockBlob.uploadBuffer).toHaveBeenCalledWith(
        FILE_BUFFER,
        BLOB_NAME,
        "uploads",
      );
      expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.licenseRenewalDocument.create).toHaveBeenCalled();
      // The persisted reference is the blob name (not a disk path).
      expect(mockPrisma.licenseRenewalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ filePath: BLOB_NAME }),
        }),
      );
    });

    it("does not touch Blob when storage is disabled but still persists the blob reference", async () => {
      mockBlob.isEnabled.mockReturnValue(false);
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: "FFD-123",
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue({
        id: "req-1",
        documents: [],
      });

      await service.uploadRenewalDocument(
        "user-1",
        "req-1",
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        FILE_BUFFER,
        BLOB_NAME,
      );

      expect(mockBlob.uploadBuffer).not.toHaveBeenCalled();
      expect(mockPrisma.licenseRenewalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ filePath: BLOB_NAME }),
        }),
      );
    });
  });

  describe("uploadRenewalDocument — fichiers remplacés / rollback (RGPD art. 9)", () => {
    const OLD_MEDICAL = "document-old-medical.jpg";
    const OTHER_LICENSE = "document-license.pdf";

    function draftWithDocuments() {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-old",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: OLD_MEDICAL,
          },
          {
            id: "doc-license",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: OTHER_LICENSE,
          },
        ],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: true,
        date: new Date().toISOString().slice(0, 10),
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue({
        id: "req-1",
        documents: [],
      });
    }

    function upload() {
      return service.uploadRenewalDocument(
        "user-1",
        "req-1",
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        FILE_BUFFER,
        BLOB_NAME,
      );
    }

    it("supprime le fichier du document remplacé (même type uniquement) après l'enregistrement du nouveau", async () => {
      draftWithDocuments();
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});

      await upload();

      expect(mockCleaner.deleteFiles).toHaveBeenCalledTimes(1);
      expect(mockCleaner.deleteFiles).toHaveBeenCalledWith(
        [OLD_MEDICAL],
        "document-replaced",
      );
      const createOrder =
        mockPrisma.licenseRenewalDocument.create.mock.invocationCallOrder[0];
      const txOrder = mockPrisma.$transaction.mock.invocationCallOrder[0];
      const cleanOrder = mockCleaner.deleteFiles.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(cleanOrder);
      expect(txOrder).toBeLessThan(cleanOrder);
    });

    it("remplacement atomique : deleteMany + create dans une même transaction", async () => {
      draftWithDocuments();
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});

      await upload();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalledWith(
        {
          where: {
            requestId: "req-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          },
        },
      );
    });

    it("aucun document précédent : aucun fichier à supprimer", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: true,
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue({
        id: "req-1",
        documents: [],
      });

      await upload();

      expect(mockCleaner.deleteFiles).toHaveBeenCalledWith(
        [],
        "document-replaced",
      );
    });

    it("échec de l'enregistrement : supprime le blob tout juste archivé, conserve l'ancien, et propage l'erreur", async () => {
      draftWithDocuments();
      const dbError = new Error("db down");
      mockPrisma.licenseRenewalDocument.create.mockRejectedValue(dbError);

      await expect(upload()).rejects.toBe(dbError);

      expect(mockBlob.uploadBuffer).toHaveBeenCalled();
      expect(mockCleaner.deleteFiles).toHaveBeenCalledTimes(1);
      expect(mockCleaner.deleteFiles).toHaveBeenCalledWith(
        [BLOB_NAME],
        "upload-rollback",
      );
      expect(
        mockPrisma.licenseRenewalRequest.findUniqueOrThrow,
      ).not.toHaveBeenCalled();
    });

    it("échec du service OCR : rien n'est archivé ni supprimé", async () => {
      draftWithDocuments();
      const ocrFailure = new Error("OCR unavailable");
      mockOcr.extractMedicalCertificateInfo.mockRejectedValue(ocrFailure);

      await expect(upload()).rejects.toBe(ocrFailure);

      expect(mockBlob.uploadBuffer).not.toHaveBeenCalled();
      expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
      expect(mockPrisma.licenseRenewalDocument.create).not.toHaveBeenCalled();
    });
  });

  describe("submitRenewalRequest", () => {
    it("should throw NotFoundException if request not found", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if request is already submitted", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * A draft carrying both documents with the given OCR hints, a user
     * without licence, and the PENDING request the submission returns.
     */
    const arrangeDraft = (
      medicalOcr: Record<string, unknown> = { isApte: true },
      licenseOcr: Record<string, unknown> = { licenseNumber: "FFD-123" },
    ) => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            ocrData: medicalOcr,
          },
          {
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            ocrData: licenseOcr,
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      const pending = {
        id: "req-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue(pending);
      return pending;
    };

    /** Nothing that could grant or extend a licence was touched (#271). */
    const expectNoLicenceGranted = () => {
      expect(mockPrisma.license.upsert).not.toHaveBeenCalled();
      expect(
        mockPrisma.licenseRenewalRequest.updateMany,
      ).not.toHaveBeenCalled();
      expect(
        mockPrisma.licenseRenewalRequest.findUnique,
      ).not.toHaveBeenCalled();
    };

    describe("waits for an administrator's decision (#271)", () => {
      it("submits as PENDING, records the submission time, and grants no licence", async () => {
        const pending = arrangeDraft();

        const result = await service.submitRenewalRequest("user-1", "req-1");

        expect(result).toEqual(pending);
        expect(mockPrisma.licenseRenewalRequest.update).toHaveBeenCalledWith({
          where: { id: "req-1", status: LicenseRenewalStatus.DRAFT },
          data: expect.objectContaining({
            status: LicenseRenewalStatus.PENDING,
            submittedAt: expect.any(Date) as unknown,
          }) as unknown,
          select: expect.any(Object) as unknown,
        });
        // Only the DRAFT → PENDING update: no approval transaction follows.
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expectNoLicenceGranted();
      });

      it("never sets a reviewer nor a decision date at submission", async () => {
        arrangeDraft();

        await service.submitRenewalRequest("user-1", "req-1");

        const [args] = mockPrisma.licenseRenewalRequest.update.mock
          .calls[0] as [{ data: Record<string, unknown> }];
        expect(args.data).not.toHaveProperty("reviewedById");
        expect(args.data).not.toHaveProperty("reviewedAt");
        expect(args.data.status).not.toBe(LicenseRenewalStatus.APPROVED);
      });

      it.each([
        ["an unfit medical certificate", { isApte: false }, undefined],
        ["an unreadable fitness", { isApte: null }, undefined],
        ["no medical reading at all", {}, undefined],
        [
          "a certificate older than the federation allows",
          { isApte: true, date: "2001-02-03" },
          undefined,
        ],
        ["a blank licence number", undefined, { licenseNumber: "   " }],
        [
          "a garbled licence number",
          undefined,
          { licenseNumber: "<<illisible>>" },
        ],
        ["no licence number", undefined, {}],
      ])(
        "submits despite %s: the OCR is only a hint for the administrator",
        async (_label, medicalOcr, licenseOcr) => {
          const pending = arrangeDraft(medicalOcr, licenseOcr);

          await expect(
            service.submitRenewalRequest("user-1", "req-1"),
          ).resolves.toEqual(pending);
          expectNoLicenceGranted();
        },
      );
    });

    describe("one PENDING request per user (#271)", () => {
      beforeEach(() => {
        arrangeDraft();
      });

      it("refuses (409) while another request of the user is PENDING, without submitting", async () => {
        mockPrisma.licenseRenewalRequest.count.mockResolvedValue(1);

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.licenseRenewalRequest.count).toHaveBeenCalledWith({
          where: {
            userId: "user-1",
            status: LicenseRenewalStatus.PENDING,
            id: { not: "req-1" },
          },
        });
        expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
        expectNoLicenceGranted();
      });

      it("checks and submits under the user's lock, conditionally on DRAFT", async () => {
        await service.submitRenewalRequest("user-1", "req-1");

        const [sql] = mockPrisma.$queryRaw.mock.calls[0] as [Prisma.Sql];
        expect(sql.sql).toContain("FOR NO KEY UPDATE");
        expect(sql.values).toEqual(["user-1"]);
        expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          mockPrisma.licenseRenewalRequest.count.mock.invocationCallOrder[0],
        );
        expect(
          mockPrisma.licenseRenewalRequest.count.mock.invocationCallOrder[0],
        ).toBeLessThan(
          mockPrisma.licenseRenewalRequest.update.mock.invocationCallOrder[0],
        );
        expect(mockPrisma.licenseRenewalRequest.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "req-1", status: LicenseRenewalStatus.DRAFT },
          }),
        );
      });

      it("answers 'already submitted' when a concurrent submission won (P2025)", async () => {
        mockPrisma.licenseRenewalRequest.update.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("No record", {
            code: "P2025",
            clientVersion: "test",
          }),
        );

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow(
          new BadRequestException("La demande a déjà été soumise"),
        );
        expectNoLicenceGranted();
      });

      it("rethrows any other database error of the submission", async () => {
        const failure = new Error("connection lost");
        mockPrisma.licenseRenewalRequest.update.mockRejectedValue(failure);

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toBe(failure);
      });
    });

    it("should throw BadRequestException if medical document is missing", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [{ type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE }],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow("Le certificat médical est obligatoire");
      expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if license document is missing", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [{ type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE }],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow("Le certificat de licence est obligatoire");
      expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if license is already valid for next season", async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 2);
      arrangeDraft();
      mockPrisma.user.findUnique.mockResolvedValue({
        license: { validUntil: futureDate },
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
    });

    it("compares the season by Paris day: a stray time on 31/08 still counts as renewed (#238)", async () => {
      jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00.000Z") });
      arrangeDraft();
      // Stored before the fix with the time of an 08:00 approval: earlier
      // than the new canonical instant, but the same Paris day.
      mockPrisma.user.findUnique.mockResolvedValue({
        license: { validUntil: new Date("2027-08-31T08:00:00.000Z") },
      });

      try {
        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow("déjà valide jusqu'au 31/08/2027");
      } finally {
        jest.useRealTimers();
      }
    });

    describe("administrator notification (#269)", () => {
      beforeEach(() => {
        mockPrisma.user.findMany.mockResolvedValue([
          { id: "admin-1" },
          { id: "admin-2" },
        ]);
      });

      it("tells every administrator that a request awaits review", async () => {
        arrangeDraft();
        mockNotifications.sendToUsers.mockResolvedValue({ recipients: 2 });

        await service.submitRenewalRequest("user-1", "req-1");
        await flushNotifications();

        expect(mockNotifications.sendToUsers).toHaveBeenCalledTimes(1);
        expect(mockNotifications.sendToUsers).toHaveBeenCalledWith(
          ["admin-1", "admin-2"],
          "LICENSE_RENEWAL_TO_REVIEW",
          expect.any(String),
          expect.any(String),
          { type: "LICENSE_RENEWAL_TO_REVIEW", requestId: "req-1" },
        );
        expect(mockNotifications.sendToUser).not.toHaveBeenCalled();
      });

      it("never fails the submission when the notification fails", async () => {
        const pending = arrangeDraft();
        mockNotifications.sendToUsers.mockRejectedValue(new Error("FCM down"));

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).resolves.toEqual(pending);
        await flushNotifications();
        expect(mockNotifications.sendToUsers).toHaveBeenCalled();
      });

      it("never fails the submission when the administrators cannot be read", async () => {
        const pending = arrangeDraft();
        mockPrisma.user.findMany.mockRejectedValue(new Error("DB hiccup"));

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).resolves.toEqual(pending);
        await flushNotifications();
        expect(mockNotifications.sendToUsers).not.toHaveBeenCalled();
      });

      it("notifies no one when the submission is refused", async () => {
        mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
          status: LicenseRenewalStatus.DRAFT,
          documents: [],
        });

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow(BadRequestException);
        await flushNotifications();
        expect(mockNotifications.sendToUsers).not.toHaveBeenCalled();
      });

      it("notifies no one when another request is already PENDING (409)", async () => {
        arrangeDraft();
        mockPrisma.licenseRenewalRequest.count.mockResolvedValue(1);

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow(ConflictException);
        await flushNotifications();
        expect(mockNotifications.sendToUsers).not.toHaveBeenCalled();
      });
    });

    // #250: a license ending this August 31 is renewable from July 1 (summer
    // campaign), not before. The granted season is computed at the
    // administrator's decision (#259), not at submission.
    describe("renewal eligibility by season (#250)", () => {
      const SEASON_END_2027 = new Date("2027-08-31T21:59:59.999Z");
      const SEASON_END_2028 = new Date("2028-08-31T21:59:59.999Z");

      const arrangeSubmit = (validUntil: Date) => {
        const pending = arrangeDraft();
        mockPrisma.user.findUnique.mockResolvedValue({
          license: { validUntil },
        });
        return pending;
      };

      const submitAt = async (now: string) => {
        jest.useFakeTimers({ now: new Date(now) });
        try {
          return await service.submitRenewalRequest("user-1", "req-1");
        } finally {
          jest.useRealTimers();
        }
      };

      it("refuses in April a license that already runs until this August 31", async () => {
        arrangeSubmit(SEASON_END_2027);

        await expect(submitAt("2027-04-10T10:00:00.000Z")).rejects.toThrow(
          "déjà valide jusqu'au 31/08/2027",
        );
        expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
      });

      it("accepts it in July (00:30 Paris on July 1, still June 30 in UTC), pending a decision", async () => {
        const pending = arrangeSubmit(SEASON_END_2027);

        await expect(submitAt("2027-06-30T22:30:00.000Z")).resolves.toEqual(
          pending,
        );
        expectNoLicenceGranted();
      });

      it("refuses in August a license already renewed for the next season", async () => {
        arrangeSubmit(SEASON_END_2028);

        await expect(submitAt("2027-08-20T10:00:00.000Z")).rejects.toThrow(
          "déjà valide jusqu'au 31/08/2028",
        );
      });

      it("accepts in March an expired license, pending a decision", async () => {
        const pending = arrangeSubmit(new Date("2026-08-31T21:59:59.999Z"));

        await expect(submitAt("2027-03-15T10:00:00.000Z")).resolves.toEqual(
          pending,
        );
        expectNoLicenceGranted();
      });
    });
  });

  // #224: the raw certificate text (health data, GDPR art. 9) must neither be
  // stored nor come back in any renewal response — rows stored before the fix
  // included.
  describe("never exposes the raw OCR text (#224)", () => {
    const RAW = "SENTINEL-RAW-224 patient asthmatique";

    /** A request as stored before the fix: `rawText` inside `ocrData`. */
    function legacyRequest(status: LicenseRenewalStatus) {
      return {
        id: "req-1",
        userId: "user-1",
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
        documents: [
          {
            id: "doc-1",
            requestId: "req-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "medical.jpg",
            ocrData: {
              isApte: true,
              date: new Date().toISOString().slice(0, 10),
              doctorName: "Martin",
              rawText: RAW,
            },
            createdAt: new Date(),
          },
          {
            id: "doc-2",
            requestId: "req-1",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "license.jpg",
            ocrData: {
              licenseNumber: "FFD-123",
              expiryDate: "2026-12-31",
              rawText: RAW,
              name: "Jean Dupont",
            },
            createdAt: new Date(),
          },
        ],
      };
    }

    function expectSanitized(result: unknown) {
      const json = JSON.stringify(result);
      expect(json).not.toContain("rawText");
      expect(json).not.toContain("SENTINEL-RAW-224");
      expect(json).not.toContain("Jean Dupont");
      // The summary the app shows survives.
      expect(json).toContain('"doctorName":"Martin"');
      expect(json).toContain('"expiryDate":"2026-12-31"');
    }

    /** Every renewal read selects explicit columns — never `include`. */
    function expectNoInclude(mock: jest.Mock) {
      for (const [args] of mock.mock.calls as [Record<string, unknown>][]) {
        expect(args).not.toHaveProperty("include");
        expect(args).toHaveProperty("select");
      }
    }

    it("GET renewal/my", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );
      expectSanitized(await service.getMyRenewalRequest("user-1"));
      expectNoInclude(mockPrisma.licenseRenewalRequest.findFirst);
    });

    it("POST renewal/start (existing draft and new draft)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );
      expectSanitized(await service.startRenewalRequest("user-1"));

      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.licenseRenewalRequest.create.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );
      expectSanitized(await service.startRenewalRequest("user-1"));
      expectNoInclude(mockPrisma.licenseRenewalRequest.findFirst);
      expectNoInclude(mockPrisma.licenseRenewalRequest.create);
    });

    it("POST renewal/:id/documents: stores and returns parsed fields only", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      // An OCR that would still hand back raw text must not get it stored.
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: true,
        date: new Date().toISOString().slice(0, 10),
        doctorName: "Martin",
        rawText: RAW,
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );

      const result = await service.uploadRenewalDocument(
        "user-1",
        "req-1",
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        FILE_BUFFER,
        BLOB_NAME,
      );

      expectSanitized(result);
      const [createArgs] = mockPrisma.licenseRenewalDocument.create.mock
        .calls[0] as [{ data: { ocrData: unknown } }];
      expect(createArgs.data.ocrData).toEqual({
        isApte: true,
        date: expect.any(String) as unknown,
        doctorName: "Martin",
      });
      expectNoInclude(mockPrisma.licenseRenewalRequest.findFirst);
      expectNoInclude(mockPrisma.licenseRenewalRequest.findUniqueOrThrow);
    });

    it("POST renewal/:id/documents: licence OCR keeps licenseNumber and expiryDate only", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: "FFD-123",
        expiryDate: "2026-12-31",
        name: "Jean Dupont",
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );

      await service.uploadRenewalDocument(
        "user-1",
        "req-1",
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        FILE_BUFFER,
        BLOB_NAME,
      );

      const [createArgs] = mockPrisma.licenseRenewalDocument.create.mock
        .calls[0] as [{ data: { ocrData: unknown; purgeDueAt: unknown } }];
      expect(createArgs.data.ocrData).toEqual({
        licenseNumber: "FFD-123",
        expiryDate: "2026-12-31",
      });
      expect(createArgs.data.purgeDueAt).toBeNull();
    });

    it("POST renewal/:id/submit (pending a decision)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.PENDING),
      );

      expectSanitized(await service.submitRenewalRequest("user-1", "req-1"));
      expect(mockPrisma.license.upsert).not.toHaveBeenCalled();
      expectNoInclude(mockPrisma.licenseRenewalRequest.findFirst);
      expectNoInclude(mockPrisma.licenseRenewalRequest.update);
    });
  });
});
