import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { LicensesService } from "./licenses.service";
import { LicenseQrService } from "./qr/license-qr.service";
import { AppleWalletPassGenerator } from "./wallet/apple-wallet-pass.generator";

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

  const mockLicenseQr = {
    buildQrCode: jest.fn(),
  };

  const mockWallet = { isAvailable: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        { provide: PrismaService, useValue: mockPrisma },
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
        discipline: null,
        qrCode: "signed-qr",
        appleWalletAvailable: true,
      });
      expect(mockLicenseQr.buildQrCode).toHaveBeenCalledWith(mockLicense);
    });

    it("exposes the discipline the holder practises without leaking the profile (#552)", async () => {
      const license = {
        userId: "1",
        number: "123",
        category: "Ten Dance",
        validUntil: new Date("2026-08-31T00:00:00.000Z"),
      };
      mockPrisma.license.findUnique.mockResolvedValue({
        ...license,
        user: {
          category: "Ten Dance",
          competitionLevelLatin: "Avancé",
          competitionLevelStandard: null,
        },
      });
      mockLicenseQr.buildQrCode.mockReturnValue("signed-qr");

      const result = await service.getLicense("1");
      expect(result.discipline).toBe("Latin");
      // Raw stored value kept for older clients.
      expect(result.category).toBe("Ten Dance");
      expect(result).not.toHaveProperty("user");
      expect(mockLicenseQr.buildQrCode).toHaveBeenCalledWith(license);
    });

    it("exposes qrCode null when QR signing is disabled", async () => {
      mockPrisma.license.findUnique.mockResolvedValue({ number: "123" });
      mockLicenseQr.buildQrCode.mockReturnValue(null);

      mockWallet.isAvailable.mockReturnValue(false);

      const result = await service.getLicense("1");
      expect(result.qrCode).toBeNull();
      expect(result.appleWalletAvailable).toBe(false);
    });

    it("never exposes the static QR nor the Wallet pass during a support access (#759)", async () => {
      mockPrisma.license.findUnique.mockResolvedValue({ number: "123" });
      mockLicenseQr.buildQrCode.mockReturnValue("signed-qr");
      mockWallet.isAvailable.mockReturnValue(true);

      const result = await service.getLicense("1", { supportAccess: true });
      expect(result.qrCode).toBeNull();
      expect(result.appleWalletAvailable).toBe(false);
      expect(mockLicenseQr.buildQrCode).not.toHaveBeenCalled();
    });

    it("should throw NotFound if not found", async () => {
      mockPrisma.license.findUnique.mockResolvedValue(null);
      await expect(service.getLicense("1")).rejects.toThrow(NotFoundException);
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

    it("returns a valid license with no holder when it has no user", async () => {
      mockPrisma.license.findFirst.mockResolvedValue({
        number: "123",
        category: "Staff",
        user: null,
      });

      const result = await service.validateStaffLicense("123");
      expect(result).toEqual({
        isValid: true,
        licenseNumber: "123",
        holder: null,
        role: "Staff",
      });
    });

    it("should return invalid when license not found", async () => {
      mockPrisma.license.findFirst.mockResolvedValue(null);

      const result = await service.validateStaffLicense("999");
      expect(result.isValid).toBe(false);
      expect(result.holder).toBeNull();
    });

    describe("Paris calendar day rule (#384)", () => {
      afterEach(() => jest.useRealTimers());

      // A license whose validUntil is 10:00 Paris (CEST) on 2026-10-12 must
      // match the filter at 23:00 Paris that day, and not at 00:01 on D+1.
      const validUntil = new Date("2026-10-12T08:00:00Z");
      const filterAt = async (nowIso: string): Promise<Date> => {
        jest.useFakeTimers({ now: new Date(nowIso) });
        mockPrisma.license.findFirst.mockResolvedValue(null);
        await service.validateStaffLicense("123");
        const where = (
          mockPrisma.license.findFirst.mock.calls.at(-1) as [
            { where: { number: string; validUntil: { gte: Date } } },
          ]
        )[0].where;
        expect(where.number).toBe("123");
        return where.validUntil.gte;
      };

      it("filters from 00:00 Paris of the current day", async () => {
        const floor = await filterAt("2026-10-12T21:00:00Z");
        expect(floor).toEqual(new Date("2026-10-11T22:00:00Z"));
        expect(validUntil.getTime()).toBeGreaterThanOrEqual(floor.getTime());
      });

      it("excludes the license from 00:01 Paris the next day", async () => {
        const floor = await filterAt("2026-10-12T22:01:00Z");
        expect(floor).toEqual(new Date("2026-10-12T22:00:00Z"));
        expect(validUntil.getTime()).toBeLessThan(floor.getTime());
      });
    });
  });
});
