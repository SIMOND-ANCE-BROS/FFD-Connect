import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash, createHmac } from "crypto";
import {
  buildEntryQr,
  entryQrStep,
  signEntryQrStep,
} from "../../licenses/qr/entry-qr";
import {
  ACTIVE_TEST_KEY_LABEL,
  ENTRY_QR_GOLDEN_VECTOR,
  testEntryQrPem,
  testEntryQrPrivateKey,
} from "../../licenses/qr/entry-qr-test-keys.mock";
import {
  buildSignedLicenseQr,
  toLicenseQrExpiry,
} from "../../licenses/qr/license-qr";
import {
  LicenseQrService,
  STALE_LICENSE_QR_MESSAGE,
} from "../../licenses/qr/license-qr.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  competitionPublicResultsSelect,
  competitionCheckInPolicySelect,
  idOnlySelect,
  publicResultSelect,
  volunteerTokenAuthSelect,
  volunteerTokenIssuedSelect,
} from "../../utils/prisma-selects";
import { createMockPrismaService } from "../__mocks__/types";
import { CompetitionCacheService } from "./competition-cache.service";
import { publicResultDetails } from "../public-result";
import {
  CompetitionResultsService,
  INVALID_SCANNED_AT_MESSAGE,
  SCANNED_AT_ROTATING_ONLY_MESSAGE,
  STATIC_QR_REFUSED_MESSAGE,
} from "./competition-results.service";

const mockPrismaService = createMockPrismaService();
const mockRedisService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(null),
};
const QR_SECRET = "q".repeat(32);

/** Independent SHA-256 so the test does not trust the code under test. */
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

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

/** A competition held today that accepts static QRs (the default, #668). */
const ordinaryCompetition = (overrides: Record<string, unknown> = {}) => ({
  date: new Date(),
  endDate: null,
  requireRotatingQr: false,
  ...overrides,
});

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
    // Check-in reads the competition first (#668): an ordinary one by default.
    mockPrismaService.competition.findUnique.mockResolvedValue(
      ordinaryCompetition(),
    );
  });

  describe("getResults", () => {
    it("returns only the public fields of each row, never the account id (#413)", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({
        id: "c1",
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            // Even if the select ever returned more, nothing else leaks.
            results: [
              {
                id: "res1",
                eventId: "e1",
                round: "Finale",
                ranking: 1,
                details: { participant: "A / B" },
                userId: "u-secret",
                createdAt: new Date(),
              },
            ],
          },
        ],
      });

      const result = await service.getResults("c1");

      expect(mockPrismaService.competition.findUnique).toHaveBeenCalledWith({
        where: { id: "c1" },
        select: competitionPublicResultsSelect,
      });
      expect(result).toEqual([
        {
          id: "res1",
          eventId: "e1",
          round: "Finale",
          ranking: 1,
          details: { participant: "A / B" },
          event: { id: "e1", category: "Latin", ageGroup: "Adult" },
        },
      ]);
      expect(result[0]).not.toHaveProperty("userId");
      // The cached payload carries the same minimised shape, under the v2 key.
      const [key, payload] = mockRedisService.set.mock.calls[0] as [
        string,
        string,
      ];
      expect(key).toBe("competitions:results:v2:c1");
      expect(payload).not.toContain("u-secret");
      expect(payload).not.toContain("userId");
    });

    it("publishes only the allow-listed detail keys, always as an object", () => {
      expect(
        publicResultDetails({
          participant: "A / B",
          club: "Club",
          bib: "12",
          status: "QUALIFIED",
          marks: 4,
          totalParticipants: 8,
          licenseNumber: "123456",
          birthDate: "2000-01-01",
          name: null,
        }),
      ).toEqual({
        participant: "A / B",
        club: "Club",
        bib: "12",
        status: "QUALIFIED",
        marks: 4,
        totalParticipants: 8,
      });
      expect(publicResultDetails(null)).toEqual({});
      expect(publicResultDetails(["x"])).toEqual({});
      expect(publicResultDetails("x")).toEqual({});
    });

    it("selects the results without userId nor createdAt", () => {
      const rowSelect =
        competitionPublicResultsSelect.events.select.results.select;
      expect(rowSelect).toBe(publicResultSelect);
      expect(Object.keys(rowSelect).sort()).toEqual([
        "details",
        "eventId",
        "id",
        "ranking",
        "round",
      ]);
    });

    it("never reads the pre-#413 cache key", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({
        id: "c1",
        events: [],
      });
      await service.getResults("c1");
      expect(mockRedisService.get).toHaveBeenCalledWith(
        "competitions:results:v2:c1",
      );
      expect(mockRedisService.get).not.toHaveBeenCalledWith(
        "competitions:results:c1",
      );
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

  describe("generateVolunteerToken", () => {
    it("stores only the SHA-256 hash and returns the plain token once", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({ id: "c1" });
      mockPrismaService.volunteerToken.create.mockResolvedValue({
        id: "vt-1",
        competitionId: "c1",
        expiresAt: new Date(),
        name: "Jean",
        createdAt: new Date(),
      });

      const result = await service.generateVolunteerToken("c1", "Jean");

      expect(mockPrismaService.competition.findUnique).toHaveBeenCalledWith({
        where: { id: "c1" },
        select: idOnlySelect,
      });
      const createArgs = mockPrismaService.volunteerToken.create.mock
        .calls[0][0] as {
        data: { token: string; competitionId: string; name: string };
        select: unknown;
      };
      expect(result.token).toMatch(/^[0-9a-f]{64}$/);
      expect(createArgs.data.token).toBe(sha256(result.token));
      expect(createArgs.data.token).not.toBe(result.token);
      expect(createArgs.data).toMatchObject({
        competitionId: "c1",
        name: "Jean",
      });
      expect(createArgs.select).toBe(volunteerTokenIssuedSelect);
      expect(result.accessUrl).toContain(`token=${result.token}`);
      expect(result.accessUrl).toContain("id=c1");
      expect(result.id).toBe("vt-1");
    });

    it("defaults the volunteer name and expires after 24h", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({ id: "c1" });
      mockPrismaService.volunteerToken.create.mockResolvedValue({ id: "vt-1" });
      const before = Date.now();

      await service.generateVolunteerToken("c1");

      const createArgs = mockPrismaService.volunteerToken.create.mock
        .calls[0][0] as { data: { name: string; expiresAt: Date } };
      expect(createArgs.data.name).toBe("Bénévole");
      const ttl = createArgs.data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(23 * 3_600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
    });

    it("rejects an unknown competition without creating a token", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue(null);

      await expect(service.generateVolunteerToken("nope")).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.volunteerToken.create).not.toHaveBeenCalled();
    });
  });

  describe("checkInAsVolunteer", () => {
    const TOKEN = "a".repeat(64);
    const validToken = (overrides: Record<string, unknown> = {}) => ({
      id: "vt-1",
      competitionId: "c1",
      name: "Jeanne Martin",
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    });

    it("checks in with a token bound to the requested competition, without logging the token or the link name", async () => {
      const logSpy = jest
        .spyOn(service["logger"], "log")
        .mockImplementation(() => undefined);
      mockPrismaService.volunteerToken.findUnique.mockResolvedValue(
        validToken(),
      );
      const checkInSpy = jest.spyOn(service, "checkIn").mockResolvedValue({
        user: { firstName: "A", lastName: "B" },
      } as never);

      await service.checkInAsVolunteer("c1", TOKEN, "u1");

      expect(mockPrismaService.volunteerToken.findUnique).toHaveBeenCalledWith({
        where: { token: sha256(TOKEN) },
        select: volunteerTokenAuthSelect,
      });
      expect(checkInSpy).toHaveBeenCalledWith("c1", "u1", undefined);
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).not.toContain(TOKEN.slice(0, 7));
      // The link's name may be a person's (RGPD, #529): only its id is logged.
      expect(logged).not.toContain("Jeanne");
      expect(logged).not.toContain("Martin");
      expect(logged).toContain("vt-1");
      logSpy.mockRestore();
      checkInSpy.mockRestore();
    });

    it("refuses a token issued for another competition", async () => {
      mockPrismaService.volunteerToken.findUnique.mockResolvedValue(
        validToken({ competitionId: "other" }),
      );
      const checkInSpy = jest.spyOn(service, "checkIn");

      await expect(
        service.checkInAsVolunteer("c1", TOKEN, "u1"),
      ).rejects.toThrow("Lien d'accès invalide ou expiré");
      expect(checkInSpy).not.toHaveBeenCalled();
      checkInSpy.mockRestore();
    });

    it("refuses an expired token", async () => {
      mockPrismaService.volunteerToken.findUnique.mockResolvedValue(
        validToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.checkInAsVolunteer("c1", TOKEN, "u1"),
      ).rejects.toThrow("Lien d'accès invalide ou expiré");
    });

    it("refuses an unknown token", async () => {
      mockPrismaService.volunteerToken.findUnique.mockResolvedValue(null);

      await expect(
        service.checkInAsVolunteer("c1", TOKEN, "u1"),
      ).rejects.toThrow("Lien d'accès invalide ou expiré");
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
      id: "lic-1",
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
      mockPrismaService.retiredLicenseNumber.findUnique.mockResolvedValue(null);
      mockPrismaService.license.findUnique.mockResolvedValue({
        id: "lic-1",
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

  describe("checkIn — licence number changed after the QR was issued (#466)", () => {
    const validUntil = new Date(Date.now() + 30 * 86_400_000);
    /** QR issued for licence lic-1 while it carried FFD-123456. */
    const issuedQr = buildSignedLicenseQr(
      { id: "lic-1", number: "FFD-123456", validUntil },
      QR_SECRET,
    );
    /** Same licence after the rename: the app shows this one now. */
    const renewedQr = buildSignedLicenseQr(
      { id: "lic-1", number: "FFD-654321", validUntil },
      QR_SECRET,
    );
    const exp = toLicenseQrExpiry(validUntil);
    /** Number-only v1 QR issued before #466, signed independently. */
    const v1Qr = JSON.stringify({
      v: 1,
      id: "FFD-123456",
      exp,
      sig: createHmac("sha256", QR_SECRET)
        .update(JSON.stringify(["ffd-license-qr", 1, "FFD-123456", exp]))
        .digest("base64url"),
    });
    const unsignedQr = JSON.stringify({
      id: "FFD-123456",
      name: "DOE John",
      valid: true,
      type: "FFD",
    });
    const original = {
      id: "lic-1",
      user: { id: "u1", firstName: "John", lastName: "Doe" },
    };
    const newHolder = {
      id: "lic-2",
      user: { id: "u2", firstName: "Jane", lastName: "Roe" },
    };
    let warnSpy: jest.SpyInstance;

    function serviceWithMode(mode: "off" | "warn" | "enforce") {
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

    /** Licences by number and by id, as the database would answer. */
    function mockLicences(
      byNumber: Partial<Record<string, typeof original>>,
      byId: Partial<Record<string, typeof original>>,
    ) {
      mockPrismaService.license.findUnique.mockImplementation(
        (args: { where: { number?: string; id?: string } }) =>
          Promise.resolve(
            (args.where.number !== undefined
              ? byNumber[args.where.number]
              : byId[args.where.id ?? ""]) ?? null,
          ),
      );
    }

    function mockRetired(numbers: string[]) {
      mockPrismaService.retiredLicenseNumber.findUnique.mockImplementation(
        (args: { where: { number: string } }) =>
          Promise.resolve(
            numbers.includes(args.where.number)
              ? { number: args.where.number }
              : null,
          ),
      );
    }

    beforeEach(() => {
      jest.clearAllMocks();
      warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      mockPrismaService.user.findUnique.mockResolvedValue(null);
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
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    describe("rename only (old number now unused)", () => {
      beforeEach(() => {
        mockLicences(
          { "FFD-654321": original },
          { "lic-1": original, "lic-2": newHolder },
        );
        mockRetired(["FFD-123456"]);
      });

      it("refuses the QR issued before the rename (enforce)", async () => {
        await expect(
          serviceWithMode("enforce").checkIn("c1", issuedQr),
        ).rejects.toThrow(STALE_LICENSE_QR_MESSAGE);
        expect(
          mockPrismaService.registration.updateMany,
        ).not.toHaveBeenCalled();
      });

      it("checks in the licence holder with a warning (warn)", async () => {
        const result = await serviceWithMode("warn").checkIn("c1", issuedQr);

        expect(result.user).toEqual({ firstName: "John", lastName: "Doe" });
        expect(result.registrations[0].status).toBe("SUCCESS");
        expect(result.qrVerification).toEqual({
          mode: "warn",
          status: "LICENSE_MISMATCH",
          warning:
            "QR non vérifié : numéro de licence modifié depuis l'émission du QR",
        });
        expect(mockPrismaService.license.findUnique).toHaveBeenLastCalledWith({
          where: { id: "lic-1" },
          select: expect.anything(),
        });
      });

      it("accepts the QR regenerated after the rename", async () => {
        const result = await serviceWithMode("enforce").checkIn(
          "c1",
          renewedQr,
        );
        expect(result.qrVerification.status).toBe("VALID");
        expect(result.registrations[0].status).toBe("SUCCESS");
      });
    });

    describe("old number reassigned to another licence", () => {
      beforeEach(() => {
        mockLicences(
          { "FFD-123456": newHolder, "FFD-654321": original },
          { "lic-1": original, "lic-2": newHolder },
        );
        mockRetired(["FFD-123456"]);
      });

      it("never checks in the new holder with an earlier v2 QR (enforce)", async () => {
        await expect(
          serviceWithMode("enforce").checkIn("c1", issuedQr),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
      });

      it("never checks in the new holder with an earlier v2 QR (warn)", async () => {
        const result = await serviceWithMode("warn").checkIn("c1", issuedQr);

        // The licence the QR was issued for, not the number's new holder.
        expect(result.user).toEqual({ firstName: "John", lastName: "Doe" });
        expect(result.qrVerification.status).toBe("LICENSE_MISMATCH");
        expect(mockPrismaService.registration.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ userId: "u1" }),
          }),
        );
      });

      it("finds nobody when the original licence is gone (warn)", async () => {
        mockLicences({ "FFD-123456": newHolder }, { "lic-2": newHolder });
        await expect(
          serviceWithMode("warn").checkIn("c1", issuedQr),
        ).rejects.toThrow(NotFoundException);
        expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
      });

      it.each(["warn", "enforce"] as const)(
        "refuses a number-only v1 QR for the retired number (%s)",
        async (mode) => {
          await expect(
            serviceWithMode(mode).checkIn("c1", v1Qr),
          ).rejects.toThrow(STALE_LICENSE_QR_MESSAGE);
          expect(
            mockPrismaService.registration.findMany,
          ).not.toHaveBeenCalled();
        },
      );

      it("refuses a legacy unsigned QR for the retired number (warn)", async () => {
        await expect(
          serviceWithMode("warn").checkIn("c1", unsignedQr),
        ).rejects.toThrow(STALE_LICENSE_QR_MESSAGE);
        expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
      });

      it("checks in the new holder with their own v2 QR", async () => {
        const holderQr = buildSignedLicenseQr(
          { id: "lic-2", number: "FFD-123456", validUntil },
          QR_SECRET,
        );
        const result = await serviceWithMode("enforce").checkIn("c1", holderQr);
        expect(result.user).toEqual({ firstName: "Jane", lastName: "Roe" });
        expect(result.qrVerification.status).toBe("VALID");
      });

      it("does not consult retired numbers when verification is off", async () => {
        const result = await serviceWithMode("off").checkIn("c1", unsignedQr);
        expect(result.qrVerification.status).toBe("NOT_CHECKED");
        expect(
          mockPrismaService.retiredLicenseNumber.findUnique,
        ).not.toHaveBeenCalled();
      });
    });

    describe("transition: v1 QR of a number never renamed", () => {
      beforeEach(() => {
        mockLicences({ "FFD-123456": original }, { "lic-1": original });
        mockRetired([]);
      });

      it.each(["warn", "enforce"] as const)(
        "is still accepted until it expires (%s)",
        async (mode) => {
          const result = await serviceWithMode(mode).checkIn("c1", v1Qr);
          expect(result.user).toEqual({ firstName: "John", lastName: "Doe" });
          expect(result.qrVerification).toEqual({
            mode,
            status: "VALID",
            warning: null,
          });
          expect(
            mockPrismaService.retiredLicenseNumber.findUnique,
          ).toHaveBeenCalledWith({
            where: { number: "FFD-123456" },
            select: { number: true },
          });
        },
      );
    });
  });

  describe("checkIn — rotating entry QR and offline replay (#24)", () => {
    const PEM = testEntryQrPem(ACTIVE_TEST_KEY_LABEL);
    const subject = {
      licenseId: "lic-1",
      number: "FFD-123456",
      holderName: "DOE John",
    };
    const entryQrAt = (instant: Date) => {
      const step = entryQrStep(instant);
      return buildEntryQr(
        ENTRY_QR_GOLDEN_VECTOR.keyId,
        subject,
        step,
        signEntryQrStep(
          testEntryQrPrivateKey(ACTIVE_TEST_KEY_LABEL),
          ENTRY_QR_GOLDEN_VECTOR.keyId,
          subject,
          step,
        ),
      );
    };
    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    function enforcing() {
      return new CompetitionResultsService(
        mockPrismaService as unknown as PrismaService,
        mockRedisService as unknown as RedisService,
        mockCacheService as unknown as CompetitionCacheService,
        makeQrService({
          QR_SIGNING_SECRET: QR_SECRET,
          QR_SIGNATURE_MODE: "enforce",
          ENTRY_QR_SIGNING_KEY: PEM,
        }),
      );
    }

    beforeEach(() => {
      jest.clearAllMocks();
      warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
      mockPrismaService.license.findUnique.mockResolvedValue({
        id: "lic-1",
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
    });

    afterEach(() => {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("checks in a fresh rotating QR, bound to its licence", async () => {
      const result = await enforcing().checkIn("c1", entryQrAt(new Date()));
      expect(result.qrVerification).toEqual({
        mode: "enforce",
        status: "VALID",
        warning: null,
      });
      expect(result.user).toEqual({ firstName: "John", lastName: "Doe" });
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it("refuses a screenshot replayed minutes later (enforce)", async () => {
      const captured = entryQrAt(new Date(Date.now() - 5 * 60_000));
      await expect(enforcing().checkIn("c1", captured)).rejects.toThrow(
        "QR tournant périmé",
      );
      expect(mockPrismaService.registration.updateMany).not.toHaveBeenCalled();
    });

    describe("rotating QR mandatory for the competition (#668)", () => {
      const serviceIn = (mode: "off" | "warn" | "enforce") =>
        new CompetitionResultsService(
          mockPrismaService as unknown as PrismaService,
          mockRedisService as unknown as RedisService,
          mockCacheService as unknown as CompetitionCacheService,
          makeQrService({
            QR_SIGNING_SECRET: QR_SECRET,
            QR_SIGNATURE_MODE: mode,
            ENTRY_QR_SIGNING_KEY: PEM,
          }),
        );
      const v2 = () =>
        buildSignedLicenseQr(
          {
            id: "lic-1",
            number: "FFD-123456",
            validUntil: new Date(Date.now() + 30 * 86_400_000),
          },
          QR_SECRET,
        );
      const requiring = (requireRotatingQr: boolean) =>
        mockPrismaService.competition.findUnique.mockResolvedValue(
          ordinaryCompetition({ requireRotatingQr }),
        );

      it.each(["off", "warn", "enforce"] as const)(
        "refuses a genuine static v2 QR (Wallet pass) in %s mode",
        async (mode) => {
          requiring(true);
          await expect(serviceIn(mode).checkIn("c1", v2())).rejects.toThrow(
            new BadRequestException(STATIC_QR_REFUSED_MESSAGE),
          );
          // Refused before any lookup: nothing is read nor checked in.
          expect(mockPrismaService.license.findUnique).not.toHaveBeenCalled();
          expect(
            mockPrismaService.registration.updateMany,
          ).not.toHaveBeenCalled();
          expect(mockPrismaService.competition.findUnique).toHaveBeenCalledWith(
            { where: { id: "c1" }, select: competitionCheckInPolicySelect },
          );
        },
      );

      it.each([
        ["a legacy unsigned JSON QR", '{"id":"FFD-123456"}'],
        ["a raw licence number", "FFD-123456"],
        ["a v3 QR with unusable fields", '{"v":3,"id":"FFD-123456"}'],
      ])("refuses %s", async (_label, qrData) => {
        requiring(true);
        await expect(serviceIn("warn").checkIn("c1", qrData)).rejects.toThrow(
          STATIC_QR_REFUSED_MESSAGE,
        );
        expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
      });

      it("checks in a fresh rotating QR", async () => {
        requiring(true);
        const result = await serviceIn("enforce").checkIn(
          "c1",
          entryQrAt(new Date()),
        );
        expect(result.registrations[0].status).toBe("SUCCESS");
        expect(result.qrVerification.status).toBe("VALID");
      });

      it("still refuses a stale rotating QR, with its own reason", async () => {
        requiring(true);
        await expect(
          serviceIn("enforce").checkIn(
            "c1",
            entryQrAt(new Date(Date.now() - 5 * 60_000)),
          ),
        ).rejects.toThrow("QR tournant périmé");
      });

      it("accepts the static v2 QR when the competition does not require it", async () => {
        requiring(false);
        const result = await serviceIn("enforce").checkIn("c1", v2());
        expect(result.registrations[0].status).toBe("SUCCESS");
      });

      it("refuses a check-in for an unknown competition", async () => {
        mockPrismaService.competition.findUnique.mockResolvedValue(null);
        await expect(
          serviceIn("enforce").checkIn("c1", entryQrAt(new Date())),
        ).rejects.toThrow(NotFoundException);
        expect(mockPrismaService.license.findUnique).not.toHaveBeenCalled();
      });
    });

    describe("offline replay with a claimed scan time", () => {
      function withMode(mode: "off" | "warn" | "enforce") {
        return new CompetitionResultsService(
          mockPrismaService as unknown as PrismaService,
          mockRedisService as unknown as RedisService,
          mockCacheService as unknown as CompetitionCacheService,
          makeQrService({
            QR_SIGNING_SECRET: QR_SECRET,
            QR_SIGNATURE_MODE: mode,
            ENTRY_QR_SIGNING_KEY: PEM,
          }),
        );
      }
      /** Competition held on the day of `instant`. */
      const competitionOn = (instant: Date, endDate: Date | null = null) =>
        mockPrismaService.competition.findUnique.mockResolvedValue(
          ordinaryCompetition({ date: instant, endDate }),
        );

      it("verifies the token as of the claimed scan, but dates the check-in at receipt", async () => {
        const scannedAt = new Date(Date.now() - 20 * 60_000);
        competitionOn(scannedAt);
        const before = Date.now();
        const result = await enforcing().checkIn(
          "c1",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.qrVerification.status).toBe("VALID");
        const call = mockPrismaService.registration.updateMany.mock
          .calls[0][0] as {
          where: unknown;
          data: { checkInTime: Date; checkInClaimedScanAt: Date };
        };
        // Single use: only registrations not checked in yet are updated.
        expect(call.where).toEqual({ id: "r1", checkedIn: false });
        expect(call.data.checkInClaimedScanAt).toEqual(scannedAt);
        expect(call.data.checkInTime.getTime()).toBeGreaterThanOrEqual(before);
        expect(mockPrismaService.competition.findUnique).toHaveBeenCalledWith({
          where: { id: "c1" },
          select: competitionCheckInPolicySelect,
        });
      });

      it("records no claimed time for an online scan", async () => {
        await enforcing().checkIn("c1", entryQrAt(new Date()));
        const call = mockPrismaService.registration.updateMany.mock
          .calls[0][0] as { data: { checkInClaimedScanAt: Date | null } };
        expect(call.data.checkInClaimedScanAt).toBeNull();
      });

      it.each(["off", "warn", "enforce"] as const)(
        "refuses a backdated replay of a token captured earlier, even in %s",
        async (mode) => {
          // Screenshot taken 10 min before the claimed scan: backdating the
          // claim to the screenshot's step is the only way in, and it is
          // bounded by everything below; a mismatched claim never passes.
          const scannedAt = new Date(Date.now() - 30 * 60_000);
          competitionOn(scannedAt);
          const captured = entryQrAt(
            new Date(scannedAt.getTime() - 10 * 60_000),
          );
          await expect(
            withMode(mode).checkIn("c1", captured, scannedAt.toISOString()),
          ).rejects.toThrow(SCANNED_AT_ROTATING_ONLY_MESSAGE);
          expect(
            mockPrismaService.registration.updateMany,
          ).not.toHaveBeenCalled();
        },
      );

      it("refuses a token backdated to before the competition day", async () => {
        const scannedAt = new Date(Date.now() - 60 * 60_000);
        // The competition is tomorrow: a claim of "scanned an hour ago" is a
        // replay of a token captured earlier.
        competitionOn(new Date(Date.now() + 36 * 3600_000));
        await expect(
          enforcing().checkIn(
            "c1",
            entryQrAt(scannedAt),
            scannedAt.toISOString(),
          ),
        ).rejects.toThrow(INVALID_SCANNED_AT_MESSAGE);
      });

      it("accepts a claim within a multi-day competition", async () => {
        const scannedAt = new Date(Date.now() - 60 * 60_000);
        competitionOn(
          new Date(Date.now() - 48 * 3600_000),
          new Date(Date.now() + 48 * 3600_000),
        );
        const result = await enforcing().checkIn(
          "c1",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.qrVerification.status).toBe("VALID");
      });

      it("refuses a claimed scan time for a static QR (v2, Wallet pass)", async () => {
        const v2 = buildSignedLicenseQr(
          {
            id: "lic-1",
            number: "FFD-123456",
            validUntil: new Date(Date.now() + 30 * 86_400_000),
          },
          QR_SECRET,
        );
        await expect(
          withMode("warn").checkIn("c1", v2, new Date().toISOString()),
        ).rejects.toThrow(SCANNED_AT_ROTATING_ONLY_MESSAGE);
        expect(
          mockPrismaService.registration.updateMany,
        ).not.toHaveBeenCalled();
      });

      it("does not drop a genuine offline replay when the mode is off", async () => {
        const scannedAt = new Date(Date.now() - 5 * 60_000);
        competitionOn(scannedAt);
        const result = await withMode("off").checkIn(
          "c1",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.registrations[0].status).toBe("SUCCESS");
        expect(result.qrVerification).toMatchObject({
          mode: "off",
          status: "VALID",
        });
      });

      it("refuses a claim for an unknown competition", async () => {
        mockPrismaService.competition.findUnique.mockResolvedValue(null);
        await expect(
          enforcing().checkIn(
            "c1",
            entryQrAt(new Date()),
            new Date().toISOString(),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it("reports a race lost to a concurrent scan as ALREADY_CHECKED_IN, not SUCCESS", async () => {
        const scannedAt = new Date(Date.now() - 5 * 60_000);
        competitionOn(scannedAt);
        mockPrismaService.registration.findMany.mockResolvedValue([
          {
            id: "r1",
            feePaid: true,
            checkedIn: false,
            event: { category: "Latin" },
          },
          {
            id: "r2",
            feePaid: true,
            checkedIn: false,
            event: { category: "Standard" },
          },
        ]);
        // r1 was checked in by another request between the read and the write.
        mockPrismaService.registration.updateMany
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 1 });
        const result = await enforcing().checkIn(
          "c1",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.registrations.map((r) => r.status)).toEqual([
          "ALREADY_CHECKED_IN",
          "SUCCESS",
        ]);
        expect(mockPrismaService.registration.updateMany).toHaveBeenCalledTimes(
          2,
        );
      });

      it("never checks a licence in twice (replayed token)", async () => {
        const scannedAt = new Date(Date.now() - 5 * 60_000);
        competitionOn(scannedAt);
        mockPrismaService.registration.findMany.mockResolvedValue([
          {
            id: "r1",
            feePaid: true,
            checkedIn: true,
            event: { category: "Latin" },
          },
        ]);
        const result = await enforcing().checkIn(
          "c1",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.registrations[0].status).toBe("ALREADY_CHECKED_IN");
        expect(
          mockPrismaService.registration.updateMany,
        ).not.toHaveBeenCalled();
      });

      it("treats a claim slightly ahead of the server clock as now", async () => {
        competitionOn(new Date());
        await enforcing().checkIn(
          "c1",
          entryQrAt(new Date()),
          new Date(Date.now() + 30_000).toISOString(),
        );
        const data = mockPrismaService.registration.updateMany.mock.calls[0][0]
          .data as { checkInClaimedScanAt: Date };
        expect(data.checkInClaimedScanAt.getTime()).toBeLessThanOrEqual(
          Date.now(),
        );
      });

      it.each([
        [
          "in the future",
          () => new Date(Date.now() + 10 * 60_000).toISOString(),
        ],
        [
          "older than 12 h",
          () => new Date(Date.now() - 13 * 3600_000).toISOString(),
        ],
        ["not a date", () => "yesterday"],
      ])("refuses a scan time %s", async (_label, scannedAt) => {
        competitionOn(new Date());
        await expect(
          enforcing().checkIn("c1", entryQrAt(new Date()), scannedAt()),
        ).rejects.toThrow(INVALID_SCANNED_AT_MESSAGE);
        expect(mockPrismaService.license.findUnique).not.toHaveBeenCalled();
      });

      it("replays a volunteer's offline scan with its scan time", async () => {
        mockPrismaService.volunteerToken.findUnique.mockResolvedValue({
          id: "vt1",
          competitionId: "c1",
          expiresAt: new Date(Date.now() + 3600_000),
        });
        const scannedAt = new Date(Date.now() - 600_000);
        competitionOn(scannedAt);
        const result = await enforcing().checkInAsVolunteer(
          "c1",
          "token",
          entryQrAt(scannedAt),
          scannedAt.toISOString(),
        );
        expect(result.qrVerification.status).toBe("VALID");
      });
    });
  });
});
