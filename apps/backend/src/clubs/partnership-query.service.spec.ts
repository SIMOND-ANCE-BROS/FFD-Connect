import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ClubRegistrationMode,
  PartnershipManagementMode,
  PartnershipStatus,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import { PartnershipQueryService } from "./partnership-query.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

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

const makePartnership = (overrides: Record<string, unknown> = {}) => ({
  id: "partnership-1",
  clubId: "club-1",
  secondaryClubId: null,
  user1Id: "user-a",
  user2Id: "user-b",
  startDate: new Date("2024-01-01"),
  endDate: null,
  status: PartnershipStatus.ACTIVE,
  managementMode: PartnershipManagementMode.PRIMARY_ONLY,
  club: { id: "club-1", name: "Test Club" },
  secondaryClub: null,
  user1: { id: "user-a", firstName: "Alice", lastName: "Martin" },
  user2: { id: "user-b", firstName: "Bob", lastName: "Dupont" },
  ...overrides,
});

describe("PartnershipQueryService", () => {
  let service: PartnershipQueryService;
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
        PartnershipQueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
      ],
    }).compile();

    service = module.get<PartnershipQueryService>(PartnershipQueryService);
    jest.clearAllMocks();
    clubsService.getClubIdForOrganizer.mockResolvedValue("club-1");
  });

  describe("getPartnerships", () => {
    it("returns partnerships with activeOnly=true by default", async () => {
      prisma.partnership.findMany.mockResolvedValue([
        makePartnership(),
      ] as never);
      const result = await service.getPartnerships("organizer-1");
      expect(result.partnerships).toHaveLength(1);
      expect(result.myClubId).toBe("club-1");
    });

    it("returns all partnerships including ended when activeOnly=false", async () => {
      prisma.partnership.findMany.mockResolvedValue([
        makePartnership(),
      ] as never);
      const result = await service.getPartnerships("organizer-1", false);
      expect(result.partnerships).toHaveLength(1);
    });
  });

  describe("getClubsForPartnership", () => {
    it("returns clubs excluding the organizer's own club", async () => {
      const clubs = [{ id: "club-2", name: "Other Club" }];
      prisma.club.findMany.mockResolvedValue(clubs as never);
      const result = await service.getClubsForPartnership("organizer-1");
      expect(result).toEqual(clubs);
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { not: "club-1" } } }),
      );
    });
  });

  describe("getMembersForPartnership", () => {
    it("throws BadRequestException when user is not CLUB role", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ role: UserRole.LICENSEE }) as never,
      );
      await expect(service.getMembersForPartnership("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when user not found (null)", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMembersForPartnership("missing")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns empty array when no valid members (blank names)", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.user.findMany.mockResolvedValue([
        {
          id: "u1",
          firstName: "  ",
          lastName: "  ",
          role: "LICENSEE",
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: "x@x.com",
          license: null,
        },
      ] as never);
      const result = await service.getMembersForPartnership("organizer-1");
      expect(result).toEqual([]);
    });

    it("returns available members, excluding those with active partnerships", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      const memberList = [
        {
          id: "u1",
          firstName: "Alice",
          lastName: "Martin",
          role: "LICENSEE",
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: "alice@test.com",
          license: null,
        },
        {
          id: "u2",
          firstName: "Bob",
          lastName: "Dupont",
          role: "LICENSEE",
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: "bob@test.com",
          license: null,
        },
      ];
      prisma.user.findMany.mockResolvedValue(memberList as never);
      prisma.partnership.findMany.mockResolvedValue([
        { user1Id: "u1", user2Id: "u3" },
      ] as never);
      const result = await service.getMembersForPartnership("organizer-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("u2");
    });

    it("includes secondary club members when secondaryClubId is provided", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      const memberList = [
        {
          id: "u1",
          firstName: "Alice",
          lastName: "Martin",
          role: "LICENSEE",
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: "alice@test.com",
          license: null,
        },
      ];
      prisma.user.findMany.mockResolvedValue(memberList as never);
      prisma.partnership.findMany.mockResolvedValue([] as never);
      const result = await service.getMembersForPartnership(
        "organizer-1",
        "club-2",
      );
      expect(result).toHaveLength(1);
    });
  });
});
