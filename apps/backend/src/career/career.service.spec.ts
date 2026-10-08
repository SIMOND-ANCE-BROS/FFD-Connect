import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { withRole } from "../auth/roles";
import { CareerQueryService } from "./career-query.service";
import { CareerService } from "./career.service";

type MockPrisma = DeepMockProxy<PrismaClient>;
const createMock = () => mockDeep<PrismaClient>();

const mockCareerQueryService = {
  getPartnershipsForUser: jest.fn(),
  getRegistrationsWithCompetition: jest.fn(),
  getResultsForUser: jest.fn(),
};

describe("CareerService", () => {
  let service: CareerService;
  let prisma: MockPrisma;
  let module: TestingModule;

  beforeEach(async () => {
    prisma = createMock();

    module = await Test.createTestingModule({
      providers: [
        CareerService,
        { provide: PrismaService, useValue: prisma },
        { provide: CareerQueryService, useValue: mockCareerQueryService },
      ],
    }).compile();

    service = module.get<CareerService>(CareerService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // searchMembers
  // ---------------------------------------------------------------------------
  describe("searchMembers", () => {
    it("should return [] for an empty query", async () => {
      const result = await service.searchMembers("user-1", "");
      expect(result).toEqual([]);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should return [] for a single-character query", async () => {
      const result = await service.searchMembers("user-1", "a");
      expect(result).toEqual([]);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should return [] for a whitespace-only query that trims to less than 2 chars", async () => {
      const result = await service.searchMembers("user-1", " ");
      expect(result).toEqual([]);
    });

    it("does not look up the requester (global search, no per-club logic)", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.searchMembers("any-user", "Al");
      expect(result).toEqual([]);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should search all LICENSEE users when requester is ADMIN", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.ADMIN,
        clubId: null,
        clubName: null,
      } as never);
      prisma.user.findMany.mockResolvedValue([
        {
          id: "u2",
          firstName: "Alice",
          lastName: "Dupont",
          clubName: "Club A",
        },
      ] as never);

      const result = await service.searchMembers("admin-1", "Ali");

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              withRole(UserRole.LICENSEE),
            ]) as unknown,
          }) as unknown,
        }),
      );
      // No same-club filter should be applied — the where object should NOT contain clubId/clubName keys
      const callArg = (
        prisma.user.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(callArg.where).not.toHaveProperty("clubId");
      expect(callArg.where).not.toHaveProperty("clubName");
      expect(result).toEqual([
        {
          id: "u2",
          firstName: "Alice",
          lastName: "Dupont",
          clubName: "Club A",
        },
      ]);
    });

    it("should search all LICENSEE users when requester is STAFF", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        clubId: "club-1",
        clubName: "Club A",
      } as never);
      prisma.user.findMany.mockResolvedValue([]);

      await service.searchMembers("staff-1", "Bo");

      const callArg = (
        prisma.user.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(callArg.where).not.toHaveProperty("clubId");
    });

    it("applies NO club restriction even for a LICENSEE requester", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.searchMembers("licensee-1", "Ma");

      const callArg = (
        prisma.user.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(callArg.where).not.toHaveProperty("clubId");
      expect(callArg.where).not.toHaveProperty("clubName");
      expect(callArg.where).toMatchObject({
        AND: expect.arrayContaining([withRole(UserRole.LICENSEE)]) as unknown,
      });
    });

    it("should map returned users to the expected shape", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.ADMIN,
        clubId: null,
        clubName: null,
      } as never);
      prisma.user.findMany.mockResolvedValue([
        { id: "u3", firstName: "Jean", lastName: "Martin", clubName: "Club C" },
        { id: "u4", firstName: "Jean", lastName: "Dupuis", clubName: null },
      ] as never);

      const result = await service.searchMembers("admin-1", "Jea");

      expect(result).toEqual([
        { id: "u3", firstName: "Jean", lastName: "Martin", clubName: "Club C" },
        { id: "u4", firstName: "Jean", lastName: "Dupuis", clubName: null },
      ]);
    });

    it("should pass the name filter using OR on firstName and lastName (case-insensitive)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.ADMIN,
        clubId: null,
        clubName: null,
      } as never);
      prisma.user.findMany.mockResolvedValue([]);

      await service.searchMembers("admin-1", "ali");

      const callArg = (
        prisma.user.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(callArg.where).toMatchObject({
        AND: expect.arrayContaining([
          {
            OR: [
              { firstName: { contains: "ali", mode: "insensitive" } },
              { lastName: { contains: "ali", mode: "insensitive" } },
            ],
          },
        ]) as unknown,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getCareerForUser
  // ---------------------------------------------------------------------------
  describe("getCareerForUser", () => {
    it("should throw NotFoundException when user is not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCareerForUser("unknown-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException with the French message", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCareerForUser("unknown-id")).rejects.toThrow(
        "Utilisateur non trouvé",
      );
    });

    it("should return career data when user is found", async () => {
      // Existence check in getCareerForUser
      prisma.user.findUnique.mockResolvedValueOnce({ id: "u1" } as never);
      // User name fetch inside getMyCareer
      prisma.user.findUnique.mockResolvedValue({
        firstName: "Paul",
        lastName: "Durand",
      } as never);
      mockCareerQueryService.getPartnershipsForUser.mockResolvedValue([]);
      mockCareerQueryService.getRegistrationsWithCompetition.mockResolvedValue(
        [],
      );
      mockCareerQueryService.getResultsForUser.mockResolvedValue([]);

      const result = await service.getCareerForUser("u1");

      expect(result).toHaveProperty("partnerships");
      expect(result).toHaveProperty("registrations");
      expect(result).toHaveProperty("results");
    });
  });

  // ---------------------------------------------------------------------------
  // getMyCareer
  // ---------------------------------------------------------------------------
  describe("getMyCareer", () => {
    const setupEmptyCareer = () => {
      mockCareerQueryService.getPartnershipsForUser.mockResolvedValue([]);
      mockCareerQueryService.getRegistrationsWithCompetition.mockResolvedValue(
        [],
      );
      mockCareerQueryService.getResultsForUser.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({
        firstName: "Luc",
        lastName: "Bernard",
      } as never);
    };

    it("should return an object with partnerships, registrations and results keys", async () => {
      setupEmptyCareer();

      const result = await service.getMyCareer("u1");

      expect(result).toEqual({
        partnerships: [],
        registrations: [],
        results: [],
      });
    });

    it("should delegate to careerQueryService.getPartnershipsForUser", async () => {
      setupEmptyCareer();

      await service.getMyCareer("u1");

      expect(
        mockCareerQueryService.getPartnershipsForUser,
      ).toHaveBeenCalledWith("u1");
    });

    it("should delegate to careerQueryService.getRegistrationsWithCompetition", async () => {
      setupEmptyCareer();

      await service.getMyCareer("u1");

      expect(
        mockCareerQueryService.getRegistrationsWithCompetition,
      ).toHaveBeenCalledWith("u1");
    });

    it("should delegate to careerQueryService.getResultsForUser with registrations (by userId)", async () => {
      const registrations = [{ event: { id: "ev-1" } }] as never;
      mockCareerQueryService.getPartnershipsForUser.mockResolvedValue([]);
      mockCareerQueryService.getRegistrationsWithCompetition.mockResolvedValue(
        registrations,
      );
      mockCareerQueryService.getResultsForUser.mockResolvedValue([]);

      await service.getMyCareer("u1");

      expect(mockCareerQueryService.getResultsForUser).toHaveBeenCalledWith(
        "u1",
        registrations,
      );
    });

    it("should include results returned by careerQueryService.getResultsForUser", async () => {
      const mockResult = {
        id: "res-1",
        eventId: "ev-1",
        ranking: 1,
        round: "FINAL",
        participantLabel: "Luc Bernard",
        event: { category: "LATIN", ageGroup: "ADULT" },
        competition: {
          title: "Compétition Test",
          date: "2025-01-01T00:00:00.000Z",
        },
      };

      mockCareerQueryService.getPartnershipsForUser.mockResolvedValue([]);
      mockCareerQueryService.getRegistrationsWithCompetition.mockResolvedValue([
        { event: { id: "ev-1", competitionId: "comp-1" } },
      ]);
      mockCareerQueryService.getResultsForUser.mockResolvedValue([mockResult]);
      prisma.user.findUnique.mockResolvedValue({
        firstName: "Luc",
        lastName: "Bernard",
      } as never);

      const { results } = await service.getMyCareer("u1");

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "res-1", ranking: 1 });
    });
  });
});
