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
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { OcrService } from "../utils/ocr.service";
import { CodedBadRequestException } from "../common/errors/coded-bad-request.exception";
import {
  LicenseRenewalService,
  RENEWAL_DOCUMENT_REJECTED,
  RenewalErrorCode,
} from "./license-renewal.service";

/** Buffer factice représentant un document uploadé en mémoire. */
const FILE_BUFFER = Buffer.from("fake-file-bytes");
/** Nom de blob factice généré par le contrôleur. */
const BLOB_NAME = "document-123.jpg";

describe("LicenseRenewalService", () => {
  let service: LicenseRenewalService;

  interface MockPrisma {
    $transaction: jest.Mock;
    license: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
    licenseRenewalRequest: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
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
    license: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    licenseRenewalRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseRenewalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: mockOcr },
        { provide: BlobStorageService, useValue: mockBlob },
        { provide: RenewalDocumentFileCleaner, useValue: mockCleaner },
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
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(existing);

      const result = await service.startRenewalRequest("user-1");

      expect(result).toEqual(existing);
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
    it("should return the most recent request if it exists", async () => {
      const existingRequest = {
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(
        existingRequest,
      );

      const result = await service.getMyRenewalRequest("user-1");

      expect(result).toEqual(existingRequest);
    });

    it("should return null if no request exists", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      const result = await service.getMyRenewalRequest("user-1");

      expect(result).toBeNull();
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

    it("should throw BadRequestException if medical certificate says inapte (isApte === false)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: false,
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

    it("should throw BadRequestException if isApte is unknown (null)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({ isApte: null });

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

    it("should throw BadRequestException if medical certificate date is too old", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: true,
        date: oldDate.toISOString().slice(0, 10),
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

    it("échec de l'OCR/validation : rien n'est archivé ni supprimé", async () => {
      draftWithDocuments();
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: false,
      });

      await expect(upload()).rejects.toThrow(BadRequestException);

      expect(mockBlob.uploadBuffer).not.toHaveBeenCalled();
      expect(mockCleaner.deleteFiles).not.toHaveBeenCalled();
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

    it("should throw BadRequestException if medical document is missing", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if license document is missing", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
        ],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if medical OCR is not marked apte", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: false },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if no license number can be determined", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "" },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        license: null,
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if license is already valid for next season", async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 2);

      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        license: { number: "FFD-123", validUntil: futureDate },
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("compares the season by Paris day: a stray time on 31/08 still counts as renewed (#238)", async () => {
      jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00.000Z") });
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
      });
      // Stored before the fix with the time of an 08:00 approval: earlier
      // than the new canonical instant, but the same Paris day.
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        license: {
          number: "FFD-123",
          validUntil: new Date("2027-08-31T08:00:00.000Z"),
        },
      });

      try {
        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow("déjà valide jusqu'au 31/08/2027");
      } finally {
        jest.useRealTimers();
      }
    });

    it("should auto-approve when all validations pass", async () => {
      const approvedRequest = {
        id: "req-1",
        status: LicenseRenewalStatus.APPROVED,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        license: null,
      });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValueOnce({
        id: "req-1",
        status: LicenseRenewalStatus.PENDING,
      });
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        approvedRequest,
      );
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ],
        user: {
          id: "user-1",
          category: "Standard",
          clubName: "Club",
          license: null,
        },
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: "L1" });

      const result = await service.submitRenewalRequest("user-1", "req-1");

      expect(result).toEqual(approvedRequest);
      expect(mockPrisma.license.upsert).toHaveBeenCalled();
      // Submission time recorded for the moderation queue (#266).
      expect(mockPrisma.licenseRenewalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LicenseRenewalStatus.PENDING,
            submittedAt: expect.any(Date) as unknown,
          }) as unknown,
        }),
      );
      // Automatic approval: atomic, conditional on PENDING, no reviewer (#261).
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
      );
      expect(mockPrisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: "req-1", status: LicenseRenewalStatus.PENDING },
        data: expect.objectContaining({
          status: LicenseRenewalStatus.APPROVED,
          reviewedById: null,
        }) as unknown,
      });
    });

    it("answers 409 and leaves the licence untouched when a concurrent decision won (#261)", async () => {
      const documents = [
        {
          id: "doc-1",
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          filePath: "/path/to/medical.jpg",
          ocrData: { isApte: true },
        },
        {
          id: "doc-2",
          type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
          filePath: "/path/to/license.jpg",
          ocrData: { licenseNumber: "FFD-123" },
        },
      ];
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue({
        id: "req-1",
      });
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.PENDING,
        userId: "user-1",
        documents,
        user: { category: null, clubName: null, license: null },
      });
      mockPrisma.licenseRenewalRequest.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.license.upsert).not.toHaveBeenCalled();
    });

    it("leaves the request PENDING, without error, when the licence number is another account's", async () => {
      const documents = [
        {
          id: "doc-1",
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          filePath: "/path/to/medical.jpg",
          ocrData: { isApte: true },
        },
        {
          id: "doc-2",
          type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
          filePath: "/path/to/license.jpg",
          ocrData: { licenseNumber: "FFD-TAKEN" },
        },
      ];
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue({
        id: "req-1",
      });
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.PENDING,
        userId: "user-1",
        documents,
        user: { category: null, clubName: null, license: null },
      });
      mockPrisma.license.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "7",
        }),
      );
      const pending = {
        id: "req-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        pending,
      );

      const result = await service.submitRenewalRequest("user-1", "req-1");

      // Seen as « submitted » by the app; the administrator decides. Nothing
      // tells the licensee that the number is registered elsewhere.
      expect(result).toEqual(pending);
    });

    it("rethrows any other approval failure", async () => {
      const documents = [
        {
          id: "doc-1",
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          filePath: "/path/to/medical.jpg",
          ocrData: { isApte: true },
        },
        {
          id: "doc-2",
          type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
          filePath: "/path/to/license.jpg",
          ocrData: { licenseNumber: "FFD-1" },
        },
      ];
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.DRAFT,
        documents,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue({
        id: "req-1",
      });
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.PENDING,
        userId: "user-1",
        documents,
        user: { category: null, clubName: null, license: null },
      });
      mockPrisma.license.upsert.mockRejectedValue(new Error("db down"));

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toThrow("db down");
    });

    it.each(["   ", "<<illisible>>"])(
      "refuses at submission an OCR licence number %j that the approval would not accept",
      async (licenseNumber) => {
        mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
          id: "req-1",
          userId: "user-1",
          status: LicenseRenewalStatus.DRAFT,
          documents: [
            {
              id: "doc-1",
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              filePath: "/m.jpg",
              ocrData: { isApte: true },
            },
            {
              id: "doc-2",
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              filePath: "/l.jpg",
              ocrData: { licenseNumber },
            },
          ],
        });
        mockPrisma.user.findUnique.mockResolvedValue({
          license: { number: "  ", validUntil: null },
        });

        await expect(
          service.submitRenewalRequest("user-1", "req-1"),
        ).rejects.toThrow("numéro de licence");
        expect(mockPrisma.licenseRenewalRequest.update).not.toHaveBeenCalled();
      },
    );

    // #250: a license ending this August 31 is renewable from July 1 (summer
    // campaign, renewed until the end of the next season), not before.
    describe("renewal eligibility by season (#250)", () => {
      const SEASON_END_2027 = new Date("2027-08-31T21:59:59.999Z");
      const SEASON_END_2028 = new Date("2028-08-31T21:59:59.999Z");

      const arrangeSubmit = (validUntil: Date) => {
        const documents = [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: "/path/to/medical.jpg",
            ocrData: { isApte: true },
          },
          {
            id: "doc-2",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path/to/license.jpg",
            ocrData: { licenseNumber: "FFD-123" },
          },
        ];
        const license = { number: "FFD-123", validUntil };
        mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
          id: "req-1",
          userId: "user-1",
          status: LicenseRenewalStatus.DRAFT,
          documents,
        });
        mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", license });
        mockPrisma.licenseRenewalRequest.update.mockResolvedValue({
          id: "req-1",
          status: LicenseRenewalStatus.APPROVED,
          documents: [],
        });
        mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
          id: "req-1",
          userId: "user-1",
          status: LicenseRenewalStatus.PENDING,
          documents,
          user: {
            id: "user-1",
            category: "Standard",
            clubName: "Club",
            license,
          },
        });
        mockPrisma.license.upsert.mockResolvedValue({ id: "L1" });
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
        expect(mockPrisma.license.upsert).not.toHaveBeenCalled();
      });

      it("renews it in July (00:30 Paris on July 1, still June 30 in UTC) until the end of the next season", async () => {
        arrangeSubmit(SEASON_END_2027);

        await submitAt("2027-06-30T22:30:00.000Z");

        expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              validUntil: SEASON_END_2028,
            }) as unknown,
          }),
        );
      });

      it("refuses in August a license already renewed for the next season", async () => {
        arrangeSubmit(SEASON_END_2028);

        await expect(submitAt("2027-08-20T10:00:00.000Z")).rejects.toThrow(
          "déjà valide jusqu'au 31/08/2028",
        );
      });

      it("renews in March an expired license until the end of the current season", async () => {
        arrangeSubmit(new Date("2026-08-31T21:59:59.999Z"));

        await submitAt("2027-03-15T10:00:00.000Z");

        expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              validUntil: SEASON_END_2027,
            }) as unknown,
          }),
        );
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

    it("POST renewal/:id/submit (automatic approval)", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.DRAFT),
      );
      mockPrisma.user.findUnique.mockResolvedValue({ license: null });
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        ...legacyRequest(LicenseRenewalStatus.PENDING),
        user: { category: "Standard", clubName: "Club", license: null },
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: "L1" });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue({
        id: "req-1",
      });
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(
        legacyRequest(LicenseRenewalStatus.APPROVED),
      );

      expectSanitized(await service.submitRenewalRequest("user-1", "req-1"));
      // The licence number read through the whitelist still renews the licence.
      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ number: "FFD-123" }) as unknown,
        }) as unknown,
      );
      expectNoInclude(mockPrisma.licenseRenewalRequest.findFirst);
      expectNoInclude(mockPrisma.licenseRenewalRequest.findUnique);
      expectNoInclude(mockPrisma.licenseRenewalRequest.update);
    });
  });

  // #225: the refusals that carry health data reach the user unchanged, but
  // what the logs read (`Error.message`, stack, filter's `code`) is a code.
  describe("medical refusals carry a stable code (#225)", () => {
    async function uploadMedical(ocr: Record<string, unknown>) {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue(ocr);
      return service
        .uploadRenewalDocument(
          "user-1",
          "req-1",
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          FILE_BUFFER,
          BLOB_NAME,
        )
        .then(
          () => {
            throw new Error("expected a refusal");
          },
          (error: unknown) => error as CodedBadRequestException,
        );
    }

    it("unfit certificate: MEDICAL_UNFIT, user message unchanged", async () => {
      const error = await uploadMedical({ isApte: false });

      expect(error).toBeInstanceOf(CodedBadRequestException);
      expect(error.code).toBe(RenewalErrorCode.MEDICAL_UNFIT);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          message:
            "Le certificat médical indique que vous n'êtes pas apte à la pratique. Le document ne peut pas être accepté.",
        }),
      );
      // The logs only see the neutral code: the fine one reveals fitness.
      expect(error.message).toBe(RENEWAL_DOCUMENT_REJECTED);
      expect(error.logCode).toBe(RENEWAL_DOCUMENT_REJECTED);
      expect(error.stack).not.toContain("apte");
      expect(error.stack).not.toContain("MEDICAL_UNFIT");
    });

    it("unreadable fitness: MEDICAL_FITNESS_UNCONFIRMED", async () => {
      const error = await uploadMedical({});
      expect(error.code).toBe(RenewalErrorCode.MEDICAL_FITNESS_UNCONFIRMED);
      expect(error.message).toBe(RENEWAL_DOCUMENT_REJECTED);
    });

    it("certificate too old: the date stays in the user message only", async () => {
      const error = await uploadMedical({ isApte: true, date: "2001-02-03" });

      expect(error.code).toBe(RenewalErrorCode.MEDICAL_CERTIFICATE_TOO_OLD);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          message:
            "Le certificat médical doit dater de moins de 12 mois. La date détectée (2001-02-03) est trop ancienne.",
        }),
      );
      expect(error.message).toBe(RENEWAL_DOCUMENT_REJECTED);
      expect(error.stack).not.toContain("2001-02-03");
    });

    it("submit without recognised fitness: MEDICAL_FITNESS_UNCONFIRMED", async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            ocrData: { isApte: false },
          },
          {
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            ocrData: { licenseNumber: "FFD-1" },
          },
        ],
      });

      await expect(
        service.submitRenewalRequest("user-1", "req-1"),
      ).rejects.toMatchObject({
        code: RenewalErrorCode.MEDICAL_FITNESS_UNCONFIRMED,
        message: RENEWAL_DOCUMENT_REJECTED,
      });
    });
  });
});
