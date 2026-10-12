// apps/backend/src/clubs/clubs-helloasso.service.spec.ts
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomBytes } from "crypto";
import { ClubRegistrationMode, PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../common/crypto/secret-cipher";
import { SecretCipherService } from "../common/crypto/secret-cipher.service";
import { clubHelloAssoSecretContext } from "../common/crypto/secret-contexts";
import { PrismaService } from "../prisma/prisma.service";
import {
  clubHelloAssoStatusSelect,
  clubIdNameSelect,
} from "../utils/prisma-selects";
import { ClubsService } from "./clubs.service";
import { ClubsHelloAssoService } from "./clubs-helloasso.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

/** ConfigService stub exposing only the encryption keys (#389). */
const cipherWith = (keys: Record<string, string | undefined> = {}) =>
  new SecretCipherService({
    get: (name: string) => keys[name],
  } as unknown as ConfigService);

// Helper factories
const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: UserRole.CLUB,
  clubId: "club-1",
  clubName: null,
  firstName: "Alice",
  lastName: "Martin",
  birthDate: new Date("1990-01-01"),
  ageGroup: null,
  category: null,
  competitionLevel: null,
  passportLevelLatin: null,
  passportLevelStandard: null,
  email: "alice@example.com",
  ...overrides,
});

const makeClub = (overrides: Record<string, unknown> = {}) => ({
  id: "club-1",
  name: "Test Club",
  helloAssoClientId: null,
  helloAssoClientSecret: null,
  helloAssoOrgSlug: null,
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  ...overrides,
});

describe("ClubsHelloAssoService", () => {
  let service: ClubsHelloAssoService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<
    Pick<ClubsService, "getClubIdForOrganizer" | "findOrCreateByName">
  >;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = {
      getClubIdForOrganizer: jest.fn().mockResolvedValue("club-1"),
      findOrCreateByName: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ClubsHelloAssoService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
        // No key configured: plaintext mode, as on an environment without it.
        { provide: SecretCipherService, useValue: cipherWith() },
      ],
    }).compile();

    service = module.get<ClubsHelloAssoService>(ClubsHelloAssoService);
    jest.clearAllMocks();
    clubsService.getClubIdForOrganizer.mockResolvedValue("club-1");
  });

  // ----------------------------------------------------------------
  // getMyClubHelloAssoStatus
  // ----------------------------------------------------------------
  describe("getMyClubHelloAssoStatus", () => {
    it("throws BadRequestException when user role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ role: UserRole.LICENSEE }) as never,
      );
      await expect(service.getMyClubHelloAssoStatus("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("accepts a licensee whose CLUB role is an extra role", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: { disabledAt: null },
        }) as never,
      );
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      const result = await service.getMyClubHelloAssoStatus("user-1");
      expect(result.helloAssoConnected).toBe(false);
    });

    it("refuses an extra CLUB role while the club is disabled", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: { disabledAt: new Date() },
        }) as never,
      );
      await expect(service.getMyClubHelloAssoStatus("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns helloAssoConnected: true when all 3 credentials are set", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(
        makeClub({
          helloAssoClientId: "id",
          helloAssoClientSecret: "secret",
          helloAssoOrgSlug: "my-org",
        }) as never,
      );
      const result = await service.getMyClubHelloAssoStatus("user-1");
      expect(result.helloAssoConnected).toBe(true);
      expect(result.organizationSlug).toBe("my-org");
    });

    it("returns helloAssoConnected: false when credentials are missing", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      const result = await service.getMyClubHelloAssoStatus("user-1");
      expect(result.helloAssoConnected).toBe(false);
      expect(result.organizationSlug).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // getMyClubHelloAssoStatus — additional branches
  // ----------------------------------------------------------------
  describe("getMyClubHelloAssoStatus — additional", () => {
    it("throws NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMyClubHelloAssoStatus("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when organizer has no club", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: null }) as never,
      );
      await expect(service.getMyClubHelloAssoStatus("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("resolves via clubName when clubId is null", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: "Test Club" }) as never,
      );
      clubsService.findOrCreateByName.mockResolvedValue(makeClub() as never);
      const result = await service.getMyClubHelloAssoStatus("user-1");
      expect(result.helloAssoConnected).toBe(false);
      expect(result.clubName).toBe("Test Club");
    });
  });

  // ----------------------------------------------------------------
  // setRegistrationMode
  // ----------------------------------------------------------------
  describe("setRegistrationMode", () => {
    it("throws NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setRegistrationMode("missing", ClubRegistrationMode.CLUB_ONLY),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when user role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ role: UserRole.LICENSEE }) as never,
      );
      await expect(
        service.setRegistrationMode("user-1", ClubRegistrationMode.CLUB_ONLY),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when organizer has no club", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: null }) as never,
      );
      await expect(
        service.setRegistrationMode("user-1", ClubRegistrationMode.CLUB_ONLY),
      ).rejects.toThrow(BadRequestException);
    });

    it("updates registration mode successfully", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.club.update.mockResolvedValue(
        makeClub({ registrationMode: ClubRegistrationMode.CLUB_ONLY }) as never,
      );
      const result = await service.setRegistrationMode(
        "user-1",
        ClubRegistrationMode.CLUB_ONLY,
      );
      expect(result.registrationMode).toBe(ClubRegistrationMode.CLUB_ONLY);
    });
  });

  // ----------------------------------------------------------------
  // connectHelloAsso
  // ----------------------------------------------------------------
  describe("connectHelloAsso", () => {
    it("throws NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.connectHelloAsso("missing", {
          clientId: "id",
          clientSecret: "s",
          organizationSlug: "slug",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when user role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ role: UserRole.LICENSEE }) as never,
      );
      await expect(
        service.connectHelloAsso("user-1", {
          clientId: "id",
          clientSecret: "s",
          organizationSlug: "slug",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when organizer has no club", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: null }) as never,
      );
      await expect(
        service.connectHelloAsso("user-1", {
          clientId: "id",
          clientSecret: "s",
          organizationSlug: "slug",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("connects HelloAsso successfully", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.club.update.mockResolvedValue(
        makeClub({
          helloAssoClientId: "id",
          helloAssoClientSecret: "s",
          helloAssoOrgSlug: "slug",
        }) as never,
      );
      const result = await service.connectHelloAsso("user-1", {
        clientId: "id",
        clientSecret: "s",
        organizationSlug: "slug",
      });
      expect(result.helloAssoConnected).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // getHelloAssoCredentialsForCompetition
  // ----------------------------------------------------------------
  describe("getHelloAssoCredentialsForCompetition", () => {
    it("returns null when competition not found", async () => {
      prisma.competition.findUnique.mockResolvedValue(null);
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toBeNull();
    });

    it("returns null when competition has no organizer", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: null,
      } as never);
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toBeNull();
    });

    it("returns null when club credentials are incomplete", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Test Club",
      } as never);
      prisma.club.findFirst.mockResolvedValue(makeClub() as never);
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toBeNull();
    });

    it("returns credentials when all set", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Test Club",
      } as never);
      prisma.club.findFirst.mockResolvedValue(
        makeClub({
          helloAssoClientId: "id",
          helloAssoClientSecret: "s",
          helloAssoOrgSlug: "slug",
        }) as never,
      );
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toEqual({
        clientId: "id",
        clientSecret: "s",
        organizationSlug: "slug",
      });
    });
  });

  // ----------------------------------------------------------------
  // Encryption at rest of the HelloAsso secret (#389)
  // ----------------------------------------------------------------
  describe("HelloAsso secret encryption at rest (#389)", () => {
    const key = randomBytes(32);
    const previousKey = randomBytes(32);
    const SECRET = "club-helloasso-secret";
    const CLUB_CTX = clubHelloAssoSecretContext("club-1");
    let encrypting: ClubsHelloAssoService;

    const mockCompetitionClub = (storedSecret: string) => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Test Club",
      } as never);
      prisma.club.findFirst.mockResolvedValue({
        id: "club-1",
        helloAssoClientId: "id",
        helloAssoClientSecret: storedSecret,
        helloAssoOrgSlug: "slug",
      } as never);
    };

    beforeEach(() => {
      encrypting = new ClubsHelloAssoService(
        prisma as unknown as PrismaService,
        clubsService as unknown as ClubsService,
        cipherWith({
          SECRETS_ENCRYPTION_KEY: key.toString("base64"),
          SECRETS_ENCRYPTION_KEY_PREVIOUS: previousKey.toString("base64"),
        }),
      );
      prisma.club.updateMany.mockResolvedValue({ count: 1 });
    });

    it("writes the secret encrypted when a key is configured", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);

      await encrypting.connectHelloAsso("user-1", {
        clientId: "id",
        clientSecret: SECRET,
        organizationSlug: "slug",
      });

      const stored = prisma.club.update.mock.calls[0][0].data
        .helloAssoClientSecret as string;
      expect(stored).not.toContain(SECRET);
      expect(isEncryptedSecret(stored)).toBe(true);
    });

    it("writes the secret in plaintext when no key is configured", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);

      await service.connectHelloAsso("user-1", {
        clientId: "id",
        clientSecret: SECRET,
        organizationSlug: "slug",
      });

      expect(
        prisma.club.update.mock.calls[0][0].data.helloAssoClientSecret,
      ).toBe(SECRET);
    });

    it("decrypts an encrypted secret without rewriting it", async () => {
      mockCompetitionClub(encryptSecret(SECRET, key, CLUB_CTX));

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result).toEqual({
        clientId: "id",
        clientSecret: SECRET,
        organizationSlug: "slug",
      });
      expect(prisma.club.updateMany).not.toHaveBeenCalled();
    });

    it("reads a legacy plaintext secret and lazily re-encrypts it", async () => {
      mockCompetitionClub(SECRET);

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result?.clientSecret).toBe(SECRET);
      expect(prisma.club.updateMany).toHaveBeenCalledTimes(1);
      const args = prisma.club.updateMany.mock.calls[0][0];
      // Compare-and-set on the legacy value: a concurrent reconnect wins.
      expect(args.where).toEqual({
        id: "club-1",
        helloAssoClientSecret: SECRET,
      });
      const rewritten = args.data.helloAssoClientSecret as string;
      expect(isEncryptedSecret(rewritten)).toBe(true);
      expect(rewritten).not.toContain(SECRET);
    });

    it("re-encrypts a secret encrypted with the previous key (rotation)", async () => {
      const oldValue = encryptSecret(SECRET, previousKey, CLUB_CTX);
      mockCompetitionClub(oldValue);

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result?.clientSecret).toBe(SECRET);
      const args = prisma.club.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({
        id: "club-1",
        helloAssoClientSecret: oldValue,
      });
      expect(args.data.helloAssoClientSecret).not.toBe(oldValue);
    });

    it("still returns the credentials when the lazy re-encryption fails", async () => {
      mockCompetitionClub(SECRET);
      prisma.club.updateMany.mockRejectedValue(
        new Error(`query failed with ${SECRET}`),
      );
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result?.clientSecret).toBe(SECRET);
      expect(warn).toHaveBeenCalledTimes(1);
      // The Prisma error message may echo the query: never logged.
      expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
      warn.mockRestore();
    });

    it("keeps a legacy plaintext secret readable and untouched without a key", async () => {
      mockCompetitionClub(SECRET);

      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result?.clientSecret).toBe(SECRET);
      expect(prisma.club.updateMany).not.toHaveBeenCalled();
    });

    it("treats the club as not connected when the secret cannot be decrypted", async () => {
      const stored = encryptSecret(SECRET, randomBytes(32), CLUB_CTX);
      mockCompetitionClub(stored);
      const error = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result).toBeNull();
      expect(JSON.stringify(error.mock.calls)).not.toContain(stored);
      expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET);
      error.mockRestore();
    });

    it("treats an encrypted secret as unreadable when the key is missing", async () => {
      mockCompetitionClub(encryptSecret(SECRET, key, CLUB_CTX));
      const error = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result).toBeNull();
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });

    it("rejects a ciphertext copied from another club (AAD context)", async () => {
      mockCompetitionClub(
        encryptSecret(SECRET, key, clubHelloAssoSecretContext("club-2")),
      );
      const error = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const result =
        await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      expect(result).toBeNull();
      expect(prisma.club.updateMany).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it("encrypts on connect with the club's own context", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);

      await encrypting.connectHelloAsso("user-1", {
        clientId: "id",
        clientSecret: SECRET,
        organizationSlug: "slug",
      });

      const stored = prisma.club.update.mock.calls[0][0].data
        .helloAssoClientSecret as string;
      expect(decryptSecret(stored, key, CLUB_CTX)).toBe(SECRET);
      expect(() =>
        decryptSecret(stored, key, clubHelloAssoSecretContext("club-2")),
      ).toThrow();
      // Only id + name are loaded to connect: never the stored credentials.
      expect(prisma.club.findUnique.mock.calls[0][0].select).toEqual(
        clubIdNameSelect,
      );
    });

    it("re-encrypts lazily with the club context", async () => {
      mockCompetitionClub(SECRET);

      await encrypting.getHelloAssoCredentialsForCompetition("comp-1");

      const rewritten = prisma.club.updateMany.mock.calls[0][0].data
        .helloAssoClientSecret as string;
      expect(decryptSecret(rewritten, key, CLUB_CTX)).toBe(SECRET);
    });

    it("never returns the secret in the club HelloAsso status", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(
        makeClub({
          helloAssoClientId: "id",
          helloAssoClientSecret: encryptSecret(SECRET, key, CLUB_CTX),
          helloAssoOrgSlug: "slug",
        }) as never,
      );

      const status = await encrypting.getMyClubHelloAssoStatus("user-1");

      expect(prisma.club.findUnique.mock.calls[0][0].select).toEqual(
        clubHelloAssoStatusSelect,
      );
      expect(status.helloAssoConnected).toBe(true);
      expect(Object.keys(status)).not.toContain("helloAssoClientSecret");
      expect(JSON.stringify(status)).not.toContain(SECRET);
      expect(JSON.stringify(status)).not.toContain("v1:");
    });
  });

  // ----------------------------------------------------------------
  // getRegistrationModeForUser
  // ----------------------------------------------------------------
  describe("getRegistrationModeForUser", () => {
    it("returns MEMBERS_AUTO_CONFIRM when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.getRegistrationModeForUser("missing");
      expect(result).toBe(ClubRegistrationMode.MEMBERS_AUTO_CONFIRM);
    });

    it("returns the club registrationMode when user has a club", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.club.findUnique.mockResolvedValue(
        makeClub({
          registrationMode: ClubRegistrationMode.CLUB_ONLY,
        }) as never,
      );
      const result = await service.getRegistrationModeForUser("user-1");
      expect(result).toBe(ClubRegistrationMode.CLUB_ONLY);
    });

    it("returns MEMBERS_AUTO_CONFIRM when user has no club info", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: null }) as never,
      );
      const result = await service.getRegistrationModeForUser("user-1");
      expect(result).toBe(ClubRegistrationMode.MEMBERS_AUTO_CONFIRM);
    });
  });
});
