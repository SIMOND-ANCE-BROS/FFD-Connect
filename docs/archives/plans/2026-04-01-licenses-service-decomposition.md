# Licenses Service Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extraire le workflow de renouvellement de licence dans un `LicenseRenewalService` dédié, laissant `LicensesService` avec uniquement les méthodes stables.

**Architecture:** `LicensesService` garde `getLicense`, `validateStaffLicense`, `renewLicense`. `LicenseRenewalService` reçoit les 5 méthodes du workflow document+OCR. `LicensesController` injecte les deux services.

**Tech Stack:** NestJS, Prisma, Jest (mocks manuels), TypeScript strict.

---

## Fichiers

- Create: `apps/backend/src/licenses/license-renewal.service.ts`
- Create: `apps/backend/src/licenses/license-renewal.service.spec.ts`
- Modify: `apps/backend/src/licenses/licenses.service.ts`
- Modify: `apps/backend/src/licenses/licenses.service.spec.ts`
- Modify: `apps/backend/src/licenses/licenses.module.ts`
- Modify: `apps/backend/src/licenses/licenses.controller.ts`
- Modify: `apps/backend/src/licenses/licenses.controller.spec.ts`

---

### Task 1 : Créer LicenseRenewalService avec spec

**Files:**

- Create: `apps/backend/src/licenses/license-renewal.service.ts`
- Create: `apps/backend/src/licenses/license-renewal.service.spec.ts`

- [x] **Step 1 : Écrire le test qui échoue**

Créer `apps/backend/src/licenses/license-renewal.service.spec.ts` :

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LicenseRenewalDocumentType, LicenseRenewalStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../utils/ocr.service';
import { LicenseRenewalService } from './license-renewal.service';

describe('LicenseRenewalService', () => {
  let service: LicenseRenewalService;

  interface MockPrisma {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseRenewalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: mockOcr },
      ],
    }).compile();

    service = module.get<LicenseRenewalService>(LicenseRenewalService);
    jest.clearAllMocks();
  });

  describe('startRenewalRequest', () => {
    it('should return existing DRAFT request if one exists', async () => {
      const existing = {
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(existing);

      const result = await service.startRenewalRequest('user-1');

      expect(result).toBe(existing);
      expect(mockPrisma.licenseRenewalRequest.create).not.toHaveBeenCalled();
    });

    it('should create a new DRAFT request if none exists', async () => {
      const newRequest = {
        id: 'req-2',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.licenseRenewalRequest.create.mockResolvedValue(newRequest);

      const result = await service.startRenewalRequest('user-1');

      expect(result).toBe(newRequest);
      expect(mockPrisma.licenseRenewalRequest.create).toHaveBeenCalled();
    });
  });

  describe('getMyRenewalRequest', () => {
    it('should return the most recent request if it exists', async () => {
      const existingRequest = {
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(existingRequest);

      const result = await service.getMyRenewalRequest('user-1');

      expect(result).toBe(existingRequest);
    });

    it('should return null if no request exists', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      const result = await service.getMyRenewalRequest('user-1');

      expect(result).toBeNull();
    });
  });

  describe('uploadRenewalDocument', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadRenewalDocument(
          'user-1',
          'req-1',
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          '/path/to/file',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request is not DRAFT', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      });

      await expect(
        service.uploadRenewalDocument(
          'user-1',
          'req-1',
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          '/path/to/file',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if medical certificate says inapte (isApte === false)', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({
        isApte: false,
      });

      await expect(
        service.uploadRenewalDocument(
          'user-1',
          'req-1',
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          '/path/to/file',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if isApte is unknown (null)', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractMedicalCertificateInfo.mockResolvedValue({ isApte: null });

      await expect(
        service.uploadRenewalDocument(
          'user-1',
          'req-1',
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          '/path/to/file',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if medical certificate date is too old', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
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
          'user-1',
          'req-1',
          LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          '/path/to/file',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload LICENSE_CERTIFICATE and return updated request', async () => {
      const updatedRequest = {
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: 'FFD-123' },
          },
        ],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: 'FFD-123',
      });
      mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
      mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
      mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(updatedRequest);

      const result = await service.uploadRenewalDocument(
        'user-1',
        'req-1',
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        '/path/to/license.jpg',
      );

      expect(result).toBe(updatedRequest);
      expect(mockPrisma.licenseRenewalDocument.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.licenseRenewalDocument.create).toHaveBeenCalled();
    });
  });

  describe('submitRenewalRequest', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if request is already submitted', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.PENDING,
        documents: [],
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if medical document is missing', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if license document is missing', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: '/path/to/medical.jpg',
            ocrData: { isApte: true },
          },
        ],
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if medical OCR is not marked apte', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: '/path/to/medical.jpg',
            ocrData: { isApte: false },
          },
          {
            id: 'doc-2',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: 'FFD-123' },
          },
        ],
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if no license number can be determined', async () => {
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: '/path/to/medical.jpg',
            ocrData: { isApte: true },
          },
          {
            id: 'doc-2',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: '' },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        license: null,
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if license is already valid for next season', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 2);

      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: '/path/to/medical.jpg',
            ocrData: { isApte: true },
          },
          {
            id: 'doc-2',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: 'FFD-123' },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        license: { number: 'FFD-123', validUntil: futureDate },
      });

      await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should auto-approve when all validations pass', async () => {
      const approvedRequest = {
        id: 'req-1',
        status: LicenseRenewalStatus.APPROVED,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
            filePath: '/path/to/medical.jpg',
            ocrData: { isApte: true },
          },
          {
            id: 'doc-2',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: 'FFD-123' },
          },
        ],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        license: null,
      });
      mockPrisma.licenseRenewalRequest.update
        .mockResolvedValueOnce({
          id: 'req-1',
          status: LicenseRenewalStatus.PENDING,
        })
        .mockResolvedValueOnce(approvedRequest);
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.PENDING,
        documents: [
          {
            id: 'doc-2',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path/to/license.jpg',
            ocrData: { licenseNumber: 'FFD-123' },
          },
        ],
        user: {
          id: 'user-1',
          category: 'Standard',
          clubName: 'Club',
          license: null,
        },
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: 'L1' });

      const result = await service.submitRenewalRequest('user-1', 'req-1');

      expect(result).toBe(approvedRequest);
      expect(mockPrisma.license.upsert).toHaveBeenCalled();
    });
  });

  describe('approveRenewalRequest', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue(null);

      await expect(service.approveRenewalRequest('req-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request is not PENDING', async () => {
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: LicenseRenewalStatus.DRAFT,
        documents: [],
        user: { id: 'user-1', license: null },
      });

      await expect(service.approveRenewalRequest('req-1')).rejects.toThrow(BadRequestException);
    });

    it('should approve request, upsert license, and update status', async () => {
      const approvedRequest = {
        id: 'req-1',
        status: LicenseRenewalStatus.APPROVED,
        documents: [],
      };
      mockPrisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        status: LicenseRenewalStatus.PENDING,
        documents: [
          {
            id: 'doc-1',
            type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
            filePath: '/path',
            ocrData: { licenseNumber: 'FFD-456' },
          },
        ],
        user: {
          id: 'user-1',
          category: 'Elite',
          clubName: 'CVDS',
          license: null,
        },
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: 'L2' });
      mockPrisma.licenseRenewalRequest.update.mockResolvedValue(approvedRequest);

      const result = await service.approveRenewalRequest('req-1');

      expect(result).toBe(approvedRequest);
      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({ number: 'FFD-456' }) as unknown,
        }) as unknown,
      );
    });
  });
});
```

- [x] **Step 2 : Vérifier que le test échoue**

```bash
cd apps/backend && npx jest license-renewal.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './license-renewal.service'`

- [x] **Step 3 : Créer l'implémentation**

Créer `apps/backend/src/licenses/license-renewal.service.ts` :

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseRenewalDocumentType, LicenseRenewalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../utils/ocr.service';

/** Âge maximum du certificat médical en mois (règle fédération : certificat récent). */
const MEDICAL_CERTIFICATE_MAX_AGE_MONTHS = 12;

@Injectable()
export class LicenseRenewalService {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
  ) {}

  /** Crée ou récupère une demande de renouvellement en brouillon pour l'utilisateur. */
  async startRenewalRequest(userId: string) {
    const existing = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId, status: LicenseRenewalStatus.DRAFT },
      include: { documents: true },
    });
    if (existing) return existing;
    return this.prisma.licenseRenewalRequest.create({
      data: { userId, status: LicenseRenewalStatus.DRAFT },
      include: { documents: true },
    });
  }

  /** Récupère la demande de renouvellement en cours (brouillon ou soumise) pour l'utilisateur. */
  async getMyRenewalRequest(userId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: true,
      },
    });
    return request ?? null;
  }

  /**
   * Ajoute un document à une demande de renouvellement et lance l'OCR selon le type.
   * Remplace tout document existant du même type pour cette demande.
   */
  async uploadRenewalDocument(
    userId: string,
    requestId: string,
    type: LicenseRenewalDocumentType,
    filePath: string,
  ) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { id: requestId, userId },
      include: { documents: true },
    });
    if (!request) throw new NotFoundException('Demande de renouvellement non trouvée');
    if (request.status !== LicenseRenewalStatus.DRAFT)
      throw new BadRequestException(
        'Seules les demandes en brouillon peuvent recevoir des documents',
      );

    let ocrData: Record<string, unknown> | null = null;
    if (type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      const medical = await this.ocrService.extractMedicalCertificateInfo(filePath);
      ocrData = medical as Record<string, unknown>;
      if (ocrData.isApte === false) {
        throw new BadRequestException(
          "Le certificat médical indique que vous n'êtes pas apte à la pratique. Le document ne peut pas être accepté.",
        );
      }
      if (ocrData.isApte !== true) {
        throw new BadRequestException(
          "Impossible de confirmer l'aptitude sur le certificat médical. Assurez-vous que le document mentionne clairement « apte à la pratique » ou « ne présente pas de contre-indication » et que l'image est lisible.",
        );
      }
      this.assertMedicalCertificateDateValid(ocrData as { date?: string }, 'upload');
    }
    if (type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE) {
      const licenseInfo = await this.ocrService.extractLicenseInfo(filePath);
      ocrData = licenseInfo as Record<string, unknown>;
    }

    await this.prisma.licenseRenewalDocument.deleteMany({
      where: { requestId, type },
    });

    await this.prisma.licenseRenewalDocument.create({
      data: {
        requestId,
        type,
        filePath,
        ocrData: (ocrData as unknown) ?? undefined,
      },
    });

    return this.prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { documents: true },
    });
  }

  /**
   * Soumet la demande de renouvellement (DRAFT → PENDING ou APPROVED).
   * Exige certificat médical et certificat de licence.
   * Si les deux validations OCR passent, la demande est auto-approuvée et la licence est renouvelée.
   */
  async submitRenewalRequest(userId: string, requestId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { id: requestId, userId },
      include: { documents: true },
    });
    if (!request) throw new NotFoundException('Demande de renouvellement non trouvée');
    if (request.status !== LicenseRenewalStatus.DRAFT)
      throw new BadRequestException('La demande a déjà été soumise');

    const medicalDoc = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    const licenseDoc = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
    );

    if (!medicalDoc)
      throw new BadRequestException(
        'Le certificat médical est obligatoire pour soumettre la demande.',
      );
    if (!licenseDoc)
      throw new BadRequestException(
        'Le certificat de licence est obligatoire pour soumettre la demande.',
      );

    const medicalOcr = medicalDoc.ocrData as {
      isApte?: boolean;
      date?: string;
    } | null;
    if (medicalOcr?.isApte !== true) {
      throw new BadRequestException(
        "Le certificat médical n'a pas été reconnu comme attestant votre aptitude. Veuillez déposer un document où « apte à la pratique » est clairement lisible.",
      );
    }
    this.assertMedicalCertificateDateValid(medicalOcr, 'submit');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { license: { select: { number: true, validUntil: true } } },
    });
    const licenseOcr = licenseDoc.ocrData as { licenseNumber?: string } | null;
    const hasLicenseNumber =
      Boolean(licenseOcr?.licenseNumber && licenseOcr.licenseNumber.length > 0) ||
      Boolean(user?.license?.number && user.license.number.length > 0);
    if (!hasLicenseNumber) {
      throw new BadRequestException(
        "Le certificat de licence n'a pas permis d'identifier un numéro de licence. Assurez-vous que le document est lisible et mentionne le numéro de licence.",
      );
    }

    const nextSeasonEnd = this.getNextSeasonEndDate();
    if (user?.license?.validUntil && new Date(user.license.validUntil) >= nextSeasonEnd) {
      throw new BadRequestException(
        "Votre licence est déjà valide pour la prochaine saison. Un renouvellement n'est pas nécessaire.",
      );
    }

    await this.prisma.licenseRenewalRequest.update({
      where: { id: requestId },
      data: { status: LicenseRenewalStatus.PENDING, updatedAt: new Date() },
    });
    return this.approveRenewalRequest(requestId);
  }

  /**
   * Approuve une demande de renouvellement (admin ou processus auto) et renouvelle la licence.
   */
  async approveRenewalRequest(requestId: string) {
    const request = await this.prisma.licenseRenewalRequest.findUnique({
      where: { id: requestId },
      include: {
        documents: true,
        user: { include: { license: true } },
      },
    });
    if (!request) throw new NotFoundException('Demande de renouvellement non trouvée');
    if (request.status !== LicenseRenewalStatus.PENDING)
      throw new BadRequestException('Seules les demandes en attente peuvent être approuvées');

    const licenseCert = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
    );
    const ocrLicenseNumber =
      licenseCert?.ocrData &&
      typeof licenseCert.ocrData === 'object' &&
      'licenseNumber' in licenseCert.ocrData
        ? String((licenseCert.ocrData as { licenseNumber?: string }).licenseNumber)
        : null;

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    nextYear.setMonth(7);
    nextYear.setDate(31);

    const licenseNumber =
      ocrLicenseNumber ??
      request.user.license?.number ??
      `FFD-${Math.floor(Math.random() * 1000000)}`;

    await this.prisma.license.upsert({
      where: { userId: request.userId },
      update: { validUntil: nextYear, updatedAt: new Date() },
      create: {
        userId: request.userId,
        number: licenseNumber,
        validUntil: nextYear,
        category: request.user.category ?? 'Standard',
        clubName: request.user.clubName ?? 'Club',
      },
    });

    return this.prisma.licenseRenewalRequest.update({
      where: { id: requestId },
      data: { status: LicenseRenewalStatus.APPROVED, updatedAt: new Date() },
      include: { documents: true },
    });
  }

  private assertMedicalCertificateDateValid(
    ocrData: { date?: string },
    context: 'upload' | 'submit',
  ): void {
    void context;
    const dateStr = ocrData.date;
    if (!dateStr) return;
    const certDate = new Date(dateStr);
    if (Number.isNaN(certDate.getTime())) return;
    const limit = new Date();
    limit.setMonth(limit.getMonth() - MEDICAL_CERTIFICATE_MAX_AGE_MONTHS);
    if (certDate < limit) {
      throw new BadRequestException(
        `Le certificat médical doit dater de moins de ${MEDICAL_CERTIFICATE_MAX_AGE_MONTHS} mois. La date détectée (${dateStr}) est trop ancienne.`,
      );
    }
  }

  private getNextSeasonEndDate(): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    d.setMonth(7);
    d.setDate(31);
    return d;
  }
}
```

- [x] **Step 4 : Vérifier que les tests passent**

```bash
cd apps/backend && npx jest license-renewal.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 13 tests

- [x] **Step 5 : Commit**

```bash
cd apps/backend && git add src/licenses/license-renewal.service.ts src/licenses/license-renewal.service.spec.ts
git commit -m "feat(licenses): create LicenseRenewalService with renewal workflow"
```

---

### Task 2 : Slim down LicensesService et mettre à jour sa spec

**Files:**

- Modify: `apps/backend/src/licenses/licenses.service.ts`
- Modify: `apps/backend/src/licenses/licenses.service.spec.ts`

- [x] **Step 1 : Réécrire licenses.service.ts**

Remplacer le contenu complet de `apps/backend/src/licenses/licenses.service.ts` :

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../utils/ocr.service';

@Injectable()
export class LicensesService {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
  ) {}

  /**
   * Récupère la licence d'un utilisateur
   */
  async getLicense(userId: string) {
    const license = await this.prisma.license.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        number: true,
        validUntil: true,
        category: true,
        clubName: true,
        qrCodeSignature: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!license) throw new NotFoundException('License non trouvée');
    return license;
  }

  /**
   * Renouvelle la licence d'un utilisateur à partir d'un certificat (OCR direct).
   */
  async renewLicense(userId: string, certificatePath: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        category: true,
        clubName: true,
        license: {
          select: {
            id: true,
            number: true,
            validUntil: true,
            category: true,
            clubName: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    const ocrData = await this.ocrService.extractLicenseInfo(certificatePath);

    if (!ocrData.licenseNumber && !user.license) {
      throw new BadRequestException(
        'Impossible de valider le certificat : numéro de licence non détecté',
      );
    }

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    nextYear.setMonth(7);
    nextYear.setDate(31);

    const licenseNumber =
      ocrData.licenseNumber ?? user.license?.number ?? `FFD-${Math.floor(Math.random() * 1000000)}`;

    return this.prisma.license.upsert({
      where: { userId },
      update: {
        validUntil: nextYear,
        updatedAt: new Date(),
      },
      create: {
        userId,
        number: licenseNumber,
        validUntil: nextYear,
        category: user.category ?? 'Standard',
        clubName: user.clubName ?? 'Vienne Handi Danse',
      },
    });
  }

  /**
   * Valide une licence de staff (WDSF / Legacy) — mock.
   */
  async validateStaffLicense(licenseNumber: string) {
    return Promise.resolve({
      isValid: true,
      licenseNumber,
      holder: 'Gabin Simond',
      role: 'Staff',
    });
  }
}
```

- [x] **Step 2 : Réécrire licenses.service.spec.ts**

Remplacer le contenu complet de `apps/backend/src/licenses/licenses.service.spec.ts` :

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../utils/ocr.service';
import { LicensesService } from './licenses.service';

describe('LicensesService', () => {
  let service: LicensesService;

  interface MockPrisma {
    license: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
  }

  interface MockOcr {
    extractLicenseInfo: jest.Mock;
  }

  const mockPrisma: MockPrisma = {
    license: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockOcr: MockOcr = {
    extractLicenseInfo: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: mockOcr },
      ],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  describe('getLicense', () => {
    it('should return license if found', async () => {
      const mockLicense = { userId: '1', number: '123' };
      mockPrisma.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.getLicense('1');
      expect(result).toBe(mockLicense);
    });

    it('should throw NotFound if not found', async () => {
      mockPrisma.license.findUnique.mockResolvedValue(null);
      await expect(service.getLicense('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('renewLicense', () => {
    it('should throw NotFound if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.renewLicense('1', 'path')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest if OCR fails and no existing license', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1', license: null });
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: null });

      await expect(service.renewLicense('1', 'path')).rejects.toThrow(BadRequestException);
    });

    it('should upsert license with detected number', async () => {
      const mockUser = {
        id: '1',
        license: null,
        category: 'A',
        clubName: 'Club',
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: 'DETECTED-123',
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: 'L1' });

      await service.renewLicense('1', 'path');

      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: '1' },
          create: expect.objectContaining({
            number: 'DETECTED-123',
            category: 'A',
            clubName: 'Club',
          }) as unknown,
        }) as unknown,
      );
    });

    it('should reuse existing license number if OCR fails', async () => {
      const mockUser = {
        id: '1',
        license: { number: 'OLD-123' },
        category: 'A',
        clubName: 'Club',
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: null });
      mockPrisma.license.upsert.mockResolvedValue({ id: 'L1' });

      await service.renewLicense('1', 'path');

      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            number: 'OLD-123',
          }) as unknown,
        }) as unknown,
      );
    });

    it('should set validUntil to next year August 31st', async () => {
      const mockUser = { id: '1', license: { number: '123' } };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: '123' });

      const fixedDate = new Date('2024-01-01');
      jest.useFakeTimers({ now: fixedDate });

      await service.renewLicense('1', 'path');

      const calls = mockPrisma.license.upsert.mock.calls as [[{ update: { validUntil: Date } }]];
      const calledDate = calls[0][0].update.validUntil;
      expect(calledDate.getFullYear()).toBe(2025);
      expect(calledDate.getMonth()).toBe(7);
      expect(calledDate.getDate()).toBe(31);

      jest.useRealTimers();
    });
  });

  describe('validateStaffLicense', () => {
    it('should return mock success', async () => {
      const result = await service.validateStaffLicense('123');
      expect(result.isValid).toBe(true);
      expect(result.licenseNumber).toBe('123');
    });
  });
});
```

- [x] **Step 3 : Vérifier que les tests licenses.service passent**

```bash
cd apps/backend && npx jest licenses.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 7 tests

- [x] **Step 4 : Vérifier toutes les suites licenses**

```bash
cd apps/backend && npx jest src/licenses --no-coverage 2>&1 | tail -10
```

Expected: All licenses suites pass (licenses.service, license-renewal.service, licenses.controller)

- [x] **Step 5 : Commit**

```bash
cd apps/backend && git add src/licenses/licenses.service.ts src/licenses/licenses.service.spec.ts
git commit -m "refactor(licenses): slim down LicensesService to stable methods only"
```

---

### Task 3 : Mettre à jour LicensesModule

**Files:**

- Modify: `apps/backend/src/licenses/licenses.module.ts`

- [x] **Step 1 : Mettre à jour licenses.module.ts**

Remplacer le contenu de `apps/backend/src/licenses/licenses.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OcrService } from '../utils/ocr.service';
import { LicenseRenewalService } from './license-renewal.service';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';

@Module({
  imports: [PrismaModule],
  controllers: [LicensesController],
  providers: [LicensesService, LicenseRenewalService, OcrService],
  exports: [LicensesService, LicenseRenewalService],
})
export class LicensesModule {}
```

- [x] **Step 2 : Vérifier toute la suite de tests**

```bash
cd apps/backend && npx jest --no-coverage 2>&1 | tail -8
```

Expected: All suites pass

- [x] **Step 3 : Commit**

```bash
cd apps/backend && git add src/licenses/licenses.module.ts
git commit -m "feat(licenses): add LicenseRenewalService to LicensesModule"
```

---

### Task 4 : Mettre à jour LicensesController

**Files:**

- Modify: `apps/backend/src/licenses/licenses.controller.ts`
- Modify: `apps/backend/src/licenses/licenses.controller.spec.ts`

- [x] **Step 1 : Mettre à jour licenses.controller.ts**

Modifier `apps/backend/src/licenses/licenses.controller.ts` :

1. Ajouter l'import de `LicenseRenewalService` après la ligne `import { LicensesService }` :

```typescript
import { LicenseRenewalService } from './license-renewal.service';
```

2. Remplacer le constructor :

```typescript
constructor(
  private readonly licensesService: LicensesService,
  private readonly licenseRenewalService: LicenseRenewalService,
) {}
```

3. Remplacer les 5 appels renewal dans les méthodes du controller :

Dans `startRenewal` :

```typescript
return this.licenseRenewalService.startRenewalRequest(req.user.userId);
```

Dans `getMyRenewal` :

```typescript
return this.licenseRenewalService.getMyRenewalRequest(req.user.userId);
```

Dans `uploadRenewalDocument` (remplacer l'appel `this.licensesService.uploadRenewalDocument`) :

```typescript
return this.licenseRenewalService.uploadRenewalDocument(req.user.userId, id, docType, file.path);
```

Dans `submitRenewal` :

```typescript
return this.licenseRenewalService.submitRenewalRequest(req.user.userId, id);
```

Dans `approveRenewal` :

```typescript
return this.licenseRenewalService.approveRenewalRequest(id);
```

- [x] **Step 2 : Mettre à jour licenses.controller.spec.ts**

Remplacer le contenu complet de `apps/backend/src/licenses/licenses.controller.spec.ts` (lire le fichier actuel d'abord pour s'assurer de ne pas perdre les tests existants, puis remplacer en ajoutant le mock `LicenseRenewalService`) :

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseRenewalDocumentType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LicenseRenewalService } from './license-renewal.service';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';

/** Minimal RequestWithUser stub for the local interface used in LicensesController */
const req = (userId: string, email = 'user@test.com') => ({ user: { userId, email } }) as any;

/** Minimal Multer file with a path (disk storage scenario) */
const multerFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    path: '/tmp/cert.png',
    mimetype: 'image/png',
    size: 1024,
    originalname: 'cert.png',
    fieldname: 'certificate',
    ...overrides,
  }) as Express.Multer.File;

describe('LicensesController', () => {
  let controller: LicensesController;
  let module: TestingModule;

  const mockLicensesService = {
    getLicense: jest.fn(),
    renewLicense: jest.fn(),
    validateStaffLicense: jest.fn(),
  };

  const mockLicenseRenewalService = {
    startRenewalRequest: jest.fn(),
    getMyRenewalRequest: jest.fn(),
    uploadRenewalDocument: jest.fn(),
    submitRenewalRequest: jest.fn(),
    approveRenewalRequest: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: mockLicensesService },
        { provide: LicenseRenewalService, useValue: mockLicenseRenewalService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LicensesController>(LicensesController);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  // ---------------------------------------------------------------------------
  // GET /licenses/my
  // ---------------------------------------------------------------------------
  describe('getMyLicense', () => {
    it('delegates to licensesService.getLicense with userId', async () => {
      mockLicensesService.getLicense.mockResolvedValue({ id: 'L1' });
      const result = await controller.getMyLicense(req('user-1'));
      expect(mockLicensesService.getLicense).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ id: 'L1' });
    });

    it('propagates NotFoundException from service', async () => {
      mockLicensesService.getLicense.mockRejectedValue(
        new NotFoundException('License non trouvée'),
      );
      await expect(controller.getMyLicense(req('user-1'))).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renew
  // ---------------------------------------------------------------------------
  describe('renewLicense', () => {
    it('delegates to licensesService.renewLicense with userId and file path', async () => {
      mockLicensesService.renewLicense.mockResolvedValue({ id: 'L2' });
      const file = multerFile({ path: '/tmp/cert.png' });
      const result = await controller.renewLicense(req('user-1'), file);
      expect(mockLicensesService.renewLicense).toHaveBeenCalledWith('user-1', '/tmp/cert.png');
      expect(result).toEqual({ id: 'L2' });
    });

    it('throws BadRequestException if no file provided', async () => {
      await expect(controller.renewLicense(req('user-1'), undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/start
  // ---------------------------------------------------------------------------
  describe('startRenewal', () => {
    it('delegates to licenseRenewalService.startRenewalRequest', async () => {
      const mockReq = { id: 'req-1', status: 'DRAFT', documents: [] };
      mockLicenseRenewalService.startRenewalRequest.mockResolvedValue(mockReq);
      const result = await controller.startRenewal(req('user-1'));
      expect(mockLicenseRenewalService.startRenewalRequest).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockReq);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /licenses/renewal/my
  // ---------------------------------------------------------------------------
  describe('getMyRenewal', () => {
    it('delegates to licenseRenewalService.getMyRenewalRequest', async () => {
      mockLicenseRenewalService.getMyRenewalRequest.mockResolvedValue(null);
      const result = await controller.getMyRenewal(req('user-1'));
      expect(mockLicenseRenewalService.getMyRenewalRequest).toHaveBeenCalledWith('user-1');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/documents
  // ---------------------------------------------------------------------------
  describe('uploadRenewalDocument', () => {
    it('delegates to licenseRenewalService.uploadRenewalDocument with MEDICAL_CERTIFICATE', async () => {
      mockLicenseRenewalService.uploadRenewalDocument.mockResolvedValue({
        id: 'req-1',
      });
      const file = multerFile({ path: '/tmp/medical.png' });
      const result = await controller.uploadRenewalDocument(
        req('user-1'),
        'req-uuid-1',
        'MEDICAL_CERTIFICATE',
        file,
      );
      expect(mockLicenseRenewalService.uploadRenewalDocument).toHaveBeenCalledWith(
        'user-1',
        'req-uuid-1',
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        '/tmp/medical.png',
      );
      expect(result).toEqual({ id: 'req-1' });
    });

    it('delegates to licenseRenewalService.uploadRenewalDocument with LICENSE_CERTIFICATE', async () => {
      mockLicenseRenewalService.uploadRenewalDocument.mockResolvedValue({
        id: 'req-1',
      });
      const file = multerFile({ path: '/tmp/license.png' });
      await controller.uploadRenewalDocument(
        req('user-1'),
        'req-uuid-1',
        'LICENSE_CERTIFICATE',
        file,
      );
      expect(mockLicenseRenewalService.uploadRenewalDocument).toHaveBeenCalledWith(
        'user-1',
        'req-uuid-1',
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        '/tmp/license.png',
      );
    });

    it('throws BadRequestException if type is invalid', async () => {
      const file = multerFile();
      await expect(
        controller.uploadRenewalDocument(req('user-1'), 'req-uuid-1', 'INVALID_TYPE', file),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if no file provided', async () => {
      await expect(
        controller.uploadRenewalDocument(
          req('user-1'),
          'req-uuid-1',
          'MEDICAL_CERTIFICATE',
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/submit
  // ---------------------------------------------------------------------------
  describe('submitRenewal', () => {
    it('delegates to licenseRenewalService.submitRenewalRequest', async () => {
      mockLicenseRenewalService.submitRenewalRequest.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });
      const result = await controller.submitRenewal(req('user-1'), 'req-uuid-1');
      expect(mockLicenseRenewalService.submitRenewalRequest).toHaveBeenCalledWith(
        'user-1',
        'req-uuid-1',
      );
      expect(result).toEqual({ id: 'req-1', status: 'APPROVED' });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/approve
  // ---------------------------------------------------------------------------
  describe('approveRenewal', () => {
    it('delegates to licenseRenewalService.approveRenewalRequest', async () => {
      mockLicenseRenewalService.approveRenewalRequest.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });
      const result = await controller.approveRenewal('req-uuid-1');
      expect(mockLicenseRenewalService.approveRenewalRequest).toHaveBeenCalledWith('req-uuid-1');
      expect(result).toEqual({ id: 'req-1', status: 'APPROVED' });
    });
  });
});
```

- [x] **Step 3 : Vérifier que toutes les suites licenses passent**

```bash
cd apps/backend && npx jest src/licenses --no-coverage 2>&1 | tail -10
```

Expected: All licenses suites pass

- [x] **Step 4 : Vérifier toute la suite de tests**

```bash
cd apps/backend && npx jest --no-coverage 2>&1 | tail -8
```

Expected: All suites pass

- [x] **Step 5 : Vérifier le typecheck TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep -v "@ffd-connect/shared" | head -20
```

Expected: Aucune erreur (l'erreur `@ffd-connect/shared` est pré-existante et non liée)

- [x] **Step 6 : Commit**

```bash
cd apps/backend && git add src/licenses/licenses.controller.ts src/licenses/licenses.controller.spec.ts
git commit -m "refactor(licenses): route renewal endpoints to LicenseRenewalService in controller"
```
