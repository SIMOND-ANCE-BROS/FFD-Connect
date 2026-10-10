import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { OcrService } from "../utils/ocr.service";
import { LicensesService } from "./licenses.service";
import { toLicenseQrExpiry } from "./qr/license-qr";
import { LicenseQrService } from "./qr/license-qr.service";
import { AppleWalletPassGenerator } from "./wallet/apple-wallet-pass.generator";

/** Buffer factice du certificat uploadé en mémoire (OCR uniquement). */
const CERT_BUFFER = Buffer.from("fake-certificate-bytes");

describe("LicensesService", () => {
  let service: LicensesService;

  interface MockPrisma {
    license: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
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
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockOcr: MockOcr = {
    extractLicenseInfo: jest.fn(),
  };

  const mockLicenseQr = {
    buildQrCode: jest.fn(),
  };

  const mockWallet = { isAvailable: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: mockOcr },
        { provide: LicenseQrService, useValue: mockLicenseQr },
        { provide: AppleWalletPassGenerator, useValue: mockWallet },
      ],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  describe("getLicense", () => {
    it("should return license if found", async () => {
      const mockLicense = {
        userId: "1",
        number: "123",
        validUntil: new Date("2026-08-31T00:00:00.000Z"),
      };
      mockPrisma.license.findUnique.mockResolvedValue(mockLicense);
      mockLicenseQr.buildQrCode.mockReturnValue("signed-qr");
      mockWallet.isAvailable.mockReturnValue(true);

      const result = await service.getLicense("1");
      expect(result).toEqual({
        ...mockLicense,
        qrCode: "signed-qr",
        appleWalletAvailable: true,
      });
      expect(mockLicenseQr.buildQrCode).toHaveBeenCalledWith(mockLicense);
    });

    it("exposes qrCode null when QR signing is disabled", async () => {
      mockPrisma.license.findUnique.mockResolvedValue({ number: "123" });
      mockLicenseQr.buildQrCode.mockReturnValue(null);

      mockWallet.isAvailable.mockReturnValue(false);

      const result = await service.getLicense("1");
      expect(result.qrCode).toBeNull();
      expect(result.appleWalletAvailable).toBe(false);
    });

    it("should throw NotFound if not found", async () => {
      mockPrisma.license.findUnique.mockResolvedValue(null);
      await expect(service.getLicense("1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("renewLicense", () => {
    it("should throw NotFound if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.renewLicense("1", CERT_BUFFER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequest if OCR fails and no existing license", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "1", license: null });
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: null });

      await expect(service.renewLicense("1", CERT_BUFFER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequest if user has no clubName", async () => {
      const mockUser = {
        id: "1",
        license: null,
        category: "A",
        clubName: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: "DETECTED-123",
      });

      await expect(service.renewLicense("1", CERT_BUFFER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should upsert license with detected number", async () => {
      const mockUser = {
        id: "1",
        license: null,
        category: "A",
        clubName: "Club",
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({
        licenseNumber: "DETECTED-123",
      });
      mockPrisma.license.upsert.mockResolvedValue({ id: "L1" });

      await service.renewLicense("1", CERT_BUFFER);

      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "1" },
          create: expect.objectContaining({
            number: "DETECTED-123",
            category: "A",
            clubName: "Club",
          }) as unknown,
        }) as unknown,
      );
    });

    it("should reuse existing license number if OCR fails", async () => {
      const mockUser = {
        id: "1",
        license: { number: "OLD-123" },
        category: "A",
        clubName: "Club",
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: null });
      mockPrisma.license.upsert.mockResolvedValue({ id: "L1" });

      await service.renewLicense("1", CERT_BUFFER);

      expect(mockPrisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            number: "OLD-123",
          }) as unknown,
        }) as unknown,
      );
    });

    it("should set validUntil to the end of the current season (#250)", async () => {
      const mockUser = {
        id: "1",
        license: { number: "123" },
        clubName: "Club Test",
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: "123" });

      // 22:30 UTC = 00:30 the next day in Paris: the time of day of the
      // validation must not leak into validUntil (#238).
      jest.useFakeTimers({ now: new Date("2024-06-14T22:30:00.000Z") });

      try {
        await service.renewLicense("1", CERT_BUFFER);
      } finally {
        jest.useRealTimers();
      }

      const calls = mockPrisma.license.upsert.mock.calls as [
        [{ update: { validUntil: Date }; create: { validUntil: Date } }],
      ];
      const { update, create } = calls[0][0];
      // 15/06/2024 in Paris: end of the current 2023-2024 season, last
      // instant of 2024-08-31 in Paris (CEST).
      expect(update.validUntil.toISOString()).toBe("2024-08-31T21:59:59.999Z");
      expect(create.validUntil.toISOString()).toBe("2024-08-31T21:59:59.999Z");
      expect(toLicenseQrExpiry(update.validUntil)).toBe("2024-08-31");
    });
  });

  describe("validateStaffLicense", () => {
    it("should return valid license when found in database", async () => {
      mockPrisma.license.findFirst.mockResolvedValue({
        number: "123",
        category: "Staff",
        user: { firstName: "Jean", lastName: "Dupont" },
      });

      const result = await service.validateStaffLicense("123");
      expect(result.isValid).toBe(true);
      expect(result.licenseNumber).toBe("123");
      expect(result.holder).toBe("Jean Dupont");
      expect(result.role).toBe("Staff");
    });

    it("should return invalid when license not found", async () => {
      mockPrisma.license.findFirst.mockResolvedValue(null);

      const result = await service.validateStaffLicense("999");
      expect(result.isValid).toBe(false);
      expect(result.holder).toBeNull();
    });
  });
});
