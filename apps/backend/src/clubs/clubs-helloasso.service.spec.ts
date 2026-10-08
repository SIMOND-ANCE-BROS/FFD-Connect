// apps/backend/src/clubs/clubs-helloasso.service.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClubRegistrationMode, PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import { ClubsHelloAssoService } from "./clubs-helloasso.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

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
