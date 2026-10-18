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
import {
  CLUB_ACCOUNT_UNRESOLVED_MESSAGES,
  ClubsService,
} from "./clubs.service";
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
  // The real club resolution (#743), on the mocked Prisma client.
  let clubsService: ClubsService;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = new ClubsService(prisma as unknown as PrismaService);

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

    it("resolves a legacy account to the one active club its name designates", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: " test club " }) as never,
      );
      prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
      prisma.club.findFirst.mockResolvedValue({ id: "club-1" } as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      const result = await service.getMyClubHelloAssoStatus("user-1");
      expect(result.clubName).toBe("Test Club");
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { equals: "test club", mode: "insensitive" } },
          take: 2,
        }),
      );
      expect(prisma.club.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "club-1", disabledAt: null },
        }),
      );
      expect(prisma.club.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "club-1" } }),
      );
      expect(prisma.club.create).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Legacy CLUB accounts without clubId (#743)
  // ----------------------------------------------------------------
  describe("legacy CLUB account without clubId (#743)", () => {
    const DTO = {
      clientId: "id",
      clientSecret: "s",
      organizationSlug: "slug",
    };
    const legacy = () =>
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: "Test Club" }) as never,
      );
    const actions = {
      status: () => service.getMyClubHelloAssoStatus("user-1"),
      mode: () =>
        service.setRegistrationMode("user-1", ClubRegistrationMode.CLUB_ONLY),
      connect: () => service.connectHelloAsso("user-1", DTO),
    };
    const expectNoClubTouched = () => {
      expect(prisma.club.create).not.toHaveBeenCalled();
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(prisma.club.findUnique).not.toHaveBeenCalled();
    };

    it.each(Object.entries(actions))(
      "%s: refuses when two clubs share the name up to case (homonyms)",
      async (_name, run) => {
        legacy();
        prisma.club.findMany.mockResolvedValue([
          { id: "club-1" },
          { id: "club-2" },
        ] as never);
        await expect(run()).rejects.toThrow(
          new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.ambiguous),
        );
        expectNoClubTouched();
      },
    );

    it.each(Object.entries(actions))(
      "%s: refuses when the club its name designates is disabled",
      async (_name, run) => {
        legacy();
        prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
        prisma.club.findFirst.mockResolvedValue(null);
        await expect(run()).rejects.toThrow(
          new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.disabled),
        );
        expectNoClubTouched();
      },
    );

    it.each(Object.entries(actions))(
      "%s: refuses, and creates no club, when no club carries the name",
      async (_name, run) => {
        legacy();
        prisma.club.findMany.mockResolvedValue([] as never);
        await expect(run()).rejects.toThrow(
          new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.none),
        );
        expectNoClubTouched();
      },
    );

    it("connect: writes the credentials on the resolved club only", async () => {
      legacy();
      prisma.club.findMany.mockResolvedValue([{ id: "club-7" }] as never);
      prisma.club.findFirst.mockResolvedValue({ id: "club-7" } as never);
      prisma.club.findUnique.mockResolvedValue({
        id: "club-7",
        name: "Test Club",
      } as never);
      await service.connectHelloAsso("user-1", DTO);
      expect(prisma.club.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "club-7" } }),
      );
      expect(prisma.club.create).not.toHaveBeenCalled();
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
        organizerClubId: "club-1",
      } as never);
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toBeNull();
    });

    it("returns null when the linked club no longer exists", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Test Club",
        organizerClubId: "club-gone",
      } as never);
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(
        service.getHelloAssoCredentialsForCompetition("comp-1"),
      ).resolves.toBeNull();
    });

    const connectedClub = makeClub({
      helloAssoClientId: "id",
      helloAssoClientSecret: "s",
      helloAssoOrgSlug: "slug",
    });

    it("returns credentials of the linked club, by id, whatever the label (#408)", async () => {
      // Label left stale by a rename: the link still finds the club.
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Old Club Name",
        organizerClubId: "club-1",
      } as never);
      prisma.club.findUnique.mockResolvedValue(connectedClub as never);
      const result =
        await service.getHelloAssoCredentialsForCompetition("comp-1");
      expect(result).toEqual({
        clientId: "id",
        clientSecret: "s",
        organizationSlug: "slug",
      });
      expect(prisma.club.findUnique).toHaveBeenCalledWith({
        where: { id: "club-1" },
        select: expect.any(Object),
      });
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("falls back to the one club the label names on an unlinked competition", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "  test club ",
        organizerClubId: null,
      } as never);
      prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
      prisma.club.findUnique.mockResolvedValue(connectedClub as never);
      await expect(
        service.getHelloAssoCredentialsForCompetition("comp-1"),
      ).resolves.toEqual({
        clientId: "id",
        clientSecret: "s",
        organizationSlug: "slug",
      });
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { equals: "test club", mode: "insensitive" } },
          take: 2,
        }),
      );
    });

    it("never picks one of two clubs whose names only differ by case (#408)", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        organizer: "Club X",
        organizerClubId: null,
      } as never);
      prisma.club.findMany.mockResolvedValue([
        { id: "club-x" },
        { id: "club-x-lower" },
      ] as never);
      await expect(
        service.getHelloAssoCredentialsForCompetition("comp-1"),
      ).resolves.toBeNull();
      expect(prisma.club.findUnique).not.toHaveBeenCalled();
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
        organizerClubId: "club-1",
      } as never);
      prisma.club.findUnique.mockResolvedValue({
        id: "club-1",
        helloAssoClientId: "id",
        helloAssoClientSecret: storedSecret,
        helloAssoOrgSlug: "slug",
      } as never);
    };

    beforeEach(() => {
      encrypting = new ClubsHelloAssoService(
        prisma as unknown as PrismaService,
        clubsService,
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

    it("reads the one club a legacy member's name designates", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: "Test Club" }) as never,
      );
      prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
      prisma.club.findUnique.mockResolvedValue({
        registrationMode: ClubRegistrationMode.CLUB_ONLY,
      } as never);
      await expect(service.getRegistrationModeForUser("user-1")).resolves.toBe(
        ClubRegistrationMode.CLUB_ONLY,
      );
      expect(prisma.club.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "club-1" } }),
      );
    });

    it("never reads a homonym club's mode for a legacy member (#743)", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: null, clubName: "Test Club" }) as never,
      );
      prisma.club.findMany.mockResolvedValue([
        { id: "club-1" },
        { id: "club-2" },
      ] as never);
      await expect(service.getRegistrationModeForUser("user-1")).resolves.toBe(
        ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
      );
      expect(prisma.club.findUnique).not.toHaveBeenCalled();
      expect(prisma.club.findFirst).not.toHaveBeenCalled();
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
