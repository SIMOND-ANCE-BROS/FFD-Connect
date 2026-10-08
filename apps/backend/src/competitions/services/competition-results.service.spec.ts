import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { buildSignedLicenseQr } from "../../licenses/qr/license-qr";
import { LicenseQrService } from "../../licenses/qr/license-qr.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { createMockPrismaService } from "../__mocks__/types";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionResultsService } from "./competition-results.service";

const mockPrismaService = createMockPrismaService();
const mockRedisService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(null),
};
const QR_SECRET = "q".repeat(32);

/** Real LicenseQrService fed with a fake config (no secret ⇒ mode off). */
function makeQrService(env: Record<string, string> = {}): LicenseQrService {
  return new LicenseQrService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

const mockCacheService = {
  invalidateCompetition: jest.fn().mockResolvedValue(null),
  invalidateAll: jest.fn().mockResolvedValue(null),
  invalidateResults: jest.fn().mockResolvedValue(null),
};

describe("CompetitionResultsService", () => {
  let service: CompetitionResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionResultsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: RedisService, useValue: mockRedisService },
        { provide: CompetitionCacheService, useValue: mockCacheService },
        { provide: LicenseQrService, useValue: makeQrService() },
      ],
    }).compile();

    service = module.get<CompetitionResultsService>(CompetitionResultsService);
    jest.clearAllMocks();
  });

  describe("getResults", () => {
    it("should return results", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({
        id: "c1",
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            results: [{ id: "res1", ranking: 1 }],
          },
        ],
      });
      const result = await service.getResults("c1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("res1");
    });

    it("should throw NotFoundException if competition not found", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue(null);
      await expect(service.getResults("invalid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return cached results if available", async () => {
      const cachedData = [{ id: "res1", ranking: 1 }];
      mockRedisService.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.getResults("c1");

      expect(mockRedisService.get).toHaveBeenCalled();
      expect(mockPrismaService.competition.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });
  });

  describe("getEventRegistrations", () => {
    it("should return registrations", async () => {
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "reg1", user: { firstName: "John" } },
      ]);
      const result = await service.getEventRegistrations("e1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("reg1");
    });
  });

  describe("getUserRegistrations", () => {
    it("should return user registrations", async () => {
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "reg1", event: { category: "Latin" } },
      ]);
      const result = await service.getUserRegistrations("u1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("reg1");
    });
  });

  describe("checkIn", () => {
    it("should throw NotFoundException if user not found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.checkIn("c1", "u1")).rejects.toThrow(
        "Utilisateur introuvable",
      );
    });

    it("should throw NotFoundException if no registrations found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);
      await expect(service.checkIn("c1", "u1")).rejects.toThrow(
        "Aucune inscription confirmée",
      );
    });

    it("should process check-in successfully", async () => {
      const mockUser = { id: "u1", firstName: "John", lastName: "Doe" };
      const mockReg = {
        id: "r1",
        feePaid: true,
        checkedIn: false,
        partnerName: "Partner",
        eventId: "e1",
        event: { category: "Latin" },
      };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.registration.findMany.mockResolvedValue([mockReg]);
      mockPrismaService.registration.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkIn("c1", "u1");

      expect(result.registrations[0].status).toBe("SUCCESS");
      expect(mockPrismaService.registration.updateMany).toHaveBeenCalled();
      expect(mockCacheService.invalidateCompetition).toHaveBeenCalledWith(
        "c1",
        "u1",
      );
    });

    it("should handle JSON QR data with ID", async () => {
      const qrData = JSON.stringify({ id: "u1" });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: true, event: { category: "Latin" } },
      ]);

      await service.checkIn("c1", qrData);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: expect.anything(),
      });
    });

    it("résout l'utilisateur par numéro de licence quand l'id échoue (QR licence)", async () => {
      // Le QR licence encode le numéro de licence, pas l'id user.
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.license.findUnique.mockResolvedValue({
        user: { id: "u1", firstName: "A", lastName: "B" },
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: true, event: { category: "Latin" } },
      ]);

      const result = await service.checkIn(
        "c1",
        JSON.stringify({ id: "LIC-123" }),
      );
      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { number: "LIC-123" },
        select: expect.anything(),
      });
      expect(result.registrations[0].status).toBe("SUCCESS");
    });

    it("should handle unpaid registrations", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: false, event: { category: "Latin" } },
      ]);

      const result = await service.checkIn("c1", "u1");
      expect(result.registrations[0].status).toBe("ERROR");
      expect(result.registrations[0].message).toBe("Droits non payés");
    });

    it("reports qrVerification NOT_CHECKED when signing is disabled", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        firstName: "A",
        lastName: "B",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: true, event: { category: "Latin" } },
      ]);

      const result = await service.checkIn("c1", "u1");
      expect(result.qrVerification).toEqual({
        mode: "off",
        status: "NOT_CHECKED",
        warning: null,
      });
    });

    it("should handle already checked-in registrations", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        {
          id: "r1",
          feePaid: true,
          checkedIn: true,
          event: { category: "Latin" },
        },
      ]);

      const result = await service.checkIn("c1", "u1");
      expect(result.registrations[0].status).toBe("ALREADY_CHECKED_IN");
    });
  });

  describe("checkIn — signed license QR (#168)", () => {
    const license = {
      number: "FFD-123456",
      validUntil: new Date(Date.now() + 30 * 86_400_000),
    };
    const signedQr = buildSignedLicenseQr(license, QR_SECRET);
    const tamperedQr = signedQr.replace("FFD-123456", "FFD-999999");
    const legacyQr = JSON.stringify({
      id: "FFD-123456",
      name: "DOE John",
      valid: true,
      type: "FFD",
    });
    let warnSpy: jest.SpyInstance;

    function serviceWithMode(mode: "warn" | "enforce") {
      return new CompetitionResultsService(
        mockPrismaService as unknown as PrismaService,
        mockRedisService as unknown as RedisService,
        mockCacheService as unknown as CompetitionCacheService,
        makeQrService({
          QR_SIGNING_SECRET: QR_SECRET,
          QR_SIGNATURE_MODE: mode,
        }),
      );
    }

    function mockLicenseHolder() {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.license.findUnique.mockResolvedValue({
        user: { id: "u1", firstName: "John", lastName: "Doe" },
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        {
          id: "r1",
          feePaid: true,
          checkedIn: false,
          event: { category: "Latin" },
        },
      ]);
      mockPrismaService.registration.updateMany.mockResolvedValue({
        count: 1,
      });
    }

    beforeEach(() => {
      jest.clearAllMocks();
      warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("checks in a genuine signed QR, resolving by license number only", async () => {
      mockLicenseHolder();
      const result = await serviceWithMode("enforce").checkIn("c1", signedQr);

      expect(result.registrations[0].status).toBe("SUCCESS");
      expect(result.qrVerification).toEqual({
        mode: "enforce",
        status: "VALID",
        warning: null,
      });
      // A verified QR carries a license number: no user-id lookup at all.
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { number: "FFD-123456" },
        select: expect.anything(),
      });
    });

    it("refuses a QR whose license number was changed (enforce)", async () => {
      mockLicenseHolder();
      await expect(
        serviceWithMode("enforce").checkIn("c1", tamperedQr),
      ).rejects.toThrow(BadRequestException);
      await expect(
        serviceWithMode("enforce").checkIn("c1", tamperedQr),
      ).rejects.toThrow("signature invalide");
      expect(mockPrismaService.license.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.registration.updateMany).not.toHaveBeenCalled();
    });

    it("refuses a legacy unsigned QR (enforce)", async () => {
      mockLicenseHolder();
      await expect(
        serviceWithMode("enforce").checkIn("c1", legacyQr),
      ).rejects.toThrow("ancien QR non signé");
    });

    it("accepts a legacy unsigned QR with a staff warning (warn)", async () => {
      mockLicenseHolder();
      const result = await serviceWithMode("warn").checkIn("c1", legacyQr);

      expect(result.registrations[0].status).toBe("SUCCESS");
      expect(result.qrVerification).toEqual({
        mode: "warn",
        status: "UNSIGNED",
        warning: "QR non vérifié : ancien QR non signé",
      });
    });

    it("accepts a tampered QR with a warning in warn mode", async () => {
      mockLicenseHolder();
      const result = await serviceWithMode("warn").checkIn("c1", tamperedQr);

      expect(result.qrVerification.status).toBe("INVALID_SIGNATURE");
      expect(result.qrVerification.warning).toBe(
        "QR non vérifié : signature invalide",
      );
    });
  });
});
