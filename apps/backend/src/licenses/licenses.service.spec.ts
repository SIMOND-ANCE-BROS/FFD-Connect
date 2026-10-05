import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { OcrService } from "../utils/ocr.service";
import { LicensesService } from "./licenses.service";

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

  describe("getLicense", () => {
    it("should return license if found", async () => {
      const mockLicense = { userId: "1", number: "123" };
      mockPrisma.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.getLicense("1");
      expect(result).toBe(mockLicense);
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

    it("should set validUntil to next year August 31st", async () => {
      const mockUser = {
        id: "1",
        license: { number: "123" },
        clubName: "Club Test",
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: "123" });

      const fixedDate = new Date("2024-01-01");
      jest.useFakeTimers({ now: fixedDate });

      await service.renewLicense("1", CERT_BUFFER);

      const calls = mockPrisma.license.upsert.mock.calls as [
        [{ update: { validUntil: Date } }],
      ];
      const calledDate = calls[0][0].update.validUntil;
      expect(calledDate.getFullYear()).toBe(2025);
      expect(calledDate.getMonth()).toBe(7);
      expect(calledDate.getDate()).toBe(31);

      jest.useRealTimers();
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
