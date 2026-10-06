import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { OcrService } from "../utils/ocr.service";
import { LicenseRenewalService } from "./license-renewal.service";

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
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    mockCleaner.deleteFiles.mockResolvedValue(undefined);
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

      expect(result).toBe(existing);
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

      expect(result).toBe(newRequest);
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

      expect(result).toBe(existingRequest);
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

      expect(result).toBe(updatedRequest);
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
      mockPrisma.licenseRenewalRequest.update
        .mockResolvedValueOnce({
          id: "req-1",
          status: LicenseRenewalStatus.PENDING,
        })
        .mockResolvedValueOnce(approvedRequest);
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

      expect(result).toBe(approvedRequest);
      expect(mockPrisma.license.upsert).toHaveBeenCalled();
    });
  });

  describe("approveRenewalRequest", () => {
    it("should throw NotFoundException if request not found", async () => {
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue(null);

      await expect(service.approveRenewalRequest("req-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException if request is not PENDING", async () => {
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: "req-1",
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
        user: { id: "user-1", license: null },
      });

      await expect(service.approveRenewalRequest("req-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should approve request, upsert license, and update status", async () => {
      const approvedRequest = {
        id: "req-1",
        status: LicenseRenewalStatus.APPROVED,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: "req-1",
        userId: "user-1",
        status: LicenseRenewalStatus.PENDING,
        documents: [
          {
            id: "doc-1",
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: "/path",
            ocrData: { licenseNumber: "FFD-456" },
          },
        ],
        user: {
          id: "user-1",
          category: "Elite",
          clubName: "CVDS",
          license: null,
        },
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: "L2" });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue(
        approvedRequest,
      );

      const result = await service.approveRenewalRequest("req-1");

      expect(result).toBe(approvedRequest);
      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          create: expect.objectContaining({ number: "FFD-456" }) as unknown,
        }) as unknown,
      );
    });
  });
});
