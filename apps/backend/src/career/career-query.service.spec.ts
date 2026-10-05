import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { CareerQueryService } from "./career-query.service";
import type { CareerRegistration } from "./career.types";

type MockPrisma = DeepMockProxy<PrismaClient>;
const createMock = () => mockDeep<PrismaClient>();

describe("CareerQueryService", () => {
  let service: CareerQueryService;
  let prisma: MockPrisma;
  let module: TestingModule;

  beforeEach(async () => {
    prisma = createMock();

    module = await Test.createTestingModule({
      providers: [
        CareerQueryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CareerQueryService>(CareerQueryService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // getPartnershipsForUser
  // ---------------------------------------------------------------------------
  describe("getPartnershipsForUser", () => {
    it("should return empty array when no partnerships exist", async () => {
      prisma.partnership.findMany.mockResolvedValue([]);

      const result = await service.getPartnershipsForUser("user-1");

      expect(result).toEqual([]);
    });

    it("should map partnerships correctly for user1", async () => {
      const startDate = new Date("2024-01-01");
      prisma.partnership.findMany.mockResolvedValue([
        {
          id: "p-1",
          status: "ACTIVE",
          startDate,
          endDate: null,
          user1Id: "user-1",
          user2Id: "user-2",
          user1: {
            id: "user-1",
            firstName: "Alice",
            lastName: "Martin",
            clubName: "Club A",
          },
          user2: {
            id: "user-2",
            firstName: "Bob",
            lastName: "Dupont",
            clubName: "Club B",
          },
          club: { name: "Club A" },
          secondaryClub: null,
        },
      ] as never);

      const result = await service.getPartnershipsForUser("user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "p-1",
        status: "ACTIVE",
        startDate: startDate.toISOString(),
        endDate: null,
        partner: {
          id: "user-2",
          firstName: "Bob",
          lastName: "Dupont",
          clubName: "Club B",
        },
        clubName: "Club A",
        secondaryClubName: null,
        isCurrent: true,
      });
    });

    it("should pick user1 as partner when userId matches user2Id", async () => {
      const startDate = new Date("2024-06-01");
      prisma.partnership.findMany.mockResolvedValue([
        {
          id: "p-2",
          status: "INACTIVE",
          startDate,
          endDate: new Date("2025-01-01"),
          user1Id: "user-1",
          user2Id: "user-2",
          user1: {
            id: "user-1",
            firstName: "Alice",
            lastName: "Martin",
            clubName: "Club A",
          },
          user2: {
            id: "user-2",
            firstName: "Bob",
            lastName: "Dupont",
            clubName: "Club B",
          },
          club: { name: "Club A" },
          secondaryClub: { name: "Club Secondary" },
        },
      ] as never);

      const result = await service.getPartnershipsForUser("user-2");

      expect(result[0].partner.id).toBe("user-1");
      expect(result[0].secondaryClubName).toBe("Club Secondary");
      expect(result[0].isCurrent).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getRegistrationsWithCompetition
  // ---------------------------------------------------------------------------
  describe("getRegistrationsWithCompetition", () => {
    it("should return empty array when no registrations exist", async () => {
      prisma.registration.findMany.mockResolvedValue([]);
      prisma.competition.findMany.mockResolvedValue([]);

      const result = await service.getRegistrationsWithCompetition("user-1");

      expect(result).toEqual([]);
    });

    it("should map registrations with competition data", async () => {
      const compDate = new Date("2025-05-01");
      prisma.registration.findMany.mockResolvedValue([
        {
          id: "reg-1",
          status: "CONFIRMED",
          bibNumber: 42,
          partnerName: "Partner Name",
          event: {
            id: "ev-1",
            category: "LATIN",
            ageGroup: "ADULT",
            level: "A",
            competitionId: "comp-1",
          },
        },
      ] as never);
      prisma.competition.findMany.mockResolvedValue([
        {
          id: "comp-1",
          title: "Test Competition",
          date: compDate,
          location: "Paris",
          status: "FINISHED",
        },
      ] as never);

      const result = await service.getRegistrationsWithCompetition("user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "reg-1",
        status: "CONFIRMED",
        bibNumber: 42,
        partnerName: "Partner Name",
        event: { id: "ev-1", category: "LATIN", ageGroup: "ADULT", level: "A" },
        competition: {
          id: "comp-1",
          title: "Test Competition",
          date: compDate.toISOString(),
          location: "Paris",
          status: "FINISHED",
        },
      });
    });

    it("should return empty competition fields when competition is not found", async () => {
      prisma.registration.findMany.mockResolvedValue([
        {
          id: "reg-2",
          status: "PENDING",
          bibNumber: null,
          partnerName: null,
          event: {
            id: "ev-2",
            category: "STANDARD",
            ageGroup: "JUNIOR",
            level: null,
            competitionId: "comp-missing",
          },
        },
      ] as never);
      prisma.competition.findMany.mockResolvedValue([]);

      const result = await service.getRegistrationsWithCompetition("user-1");

      expect(result[0].competition).toEqual({
        id: "",
        title: "",
        date: "",
        location: "",
        status: "",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getResultsForUser
  // ---------------------------------------------------------------------------
  describe("getResultsForUser", () => {
    const baseRegistrations: CareerRegistration[] = [
      {
        id: "reg-1",
        status: "CONFIRMED",
        bibNumber: 1,
        partnerName: null,
        event: {
          id: "ev-1",
          category: "LATIN",
          ageGroup: "ADULT",
          level: null,
        },
        competition: {
          id: "comp-1",
          title: "Comp",
          date: "2025-01-01T00:00:00.000Z",
          location: "Paris",
          status: "FINISHED",
        },
      },
    ];

    it("should return empty array when registrations list is empty", async () => {
      const result = await service.getResultsForUser(
        "user-1",
        [],
        "Alice",
        "Martin",
      );

      expect(result).toEqual([]);
      expect(prisma.result.findMany).not.toHaveBeenCalled();
    });

    it("returns all of the user's results (by userId, no name filter)", async () => {
      const compDate = new Date("2025-01-01");
      prisma.result.findMany.mockResolvedValue([
        {
          id: "res-1",
          eventId: "ev-1",
          round: "FINAL",
          ranking: 1,
          details: { participant: "Alice Martin" },
          event: {
            id: "ev-1",
            category: "LATIN",
            ageGroup: "ADULT",
            competitionId: "comp-1",
          },
        },
        {
          id: "res-2",
          eventId: "ev-1",
          round: "FINAL",
          ranking: 2,
          details: { participant: "Bob Dupont" },
          event: {
            id: "ev-1",
            category: "LATIN",
            ageGroup: "ADULT",
            competitionId: "comp-1",
          },
        },
      ] as never);
      prisma.competition.findMany.mockResolvedValue([
        { id: "comp-1", title: "Comp", date: compDate },
      ] as never);

      const result = await service.getResultsForUser(
        "user-1",
        baseRegistrations,
      );

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id).sort()).toEqual(["res-1", "res-2"]);
      expect(result.find((r) => r.id === "res-1")?.participantLabel).toBe(
        "Alice Martin",
      );
    });

    it("includes results even without details.participant (label null)", async () => {
      prisma.result.findMany.mockResolvedValue([
        {
          id: "res-3",
          eventId: "ev-1",
          round: "SEMIFINAL",
          ranking: 3,
          details: null,
          event: {
            id: "ev-1",
            category: "LATIN",
            ageGroup: "ADULT",
            competitionId: "comp-1",
          },
        },
      ] as never);
      prisma.competition.findMany.mockResolvedValue([]);

      const result = await service.getResultsForUser(
        "user-1",
        baseRegistrations,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("res-3");
      expect(result[0].participantLabel).toBeNull();
    });

    it("should return results sorted by competition date descending", async () => {
      const regs: CareerRegistration[] = [
        {
          ...baseRegistrations[0],
          event: { ...baseRegistrations[0].event, id: "ev-1" },
        },
        {
          id: "reg-2",
          status: "CONFIRMED",
          bibNumber: null,
          partnerName: null,
          event: {
            id: "ev-2",
            category: "STANDARD",
            ageGroup: "ADULT",
            level: null,
          },
          competition: {
            id: "comp-2",
            title: "",
            date: "",
            location: "",
            status: "",
          },
        },
      ];

      prisma.result.findMany.mockResolvedValue([
        {
          id: "res-old",
          eventId: "ev-2",
          round: "FINAL",
          ranking: 1,
          details: { participant: "Alice Martin" },
          event: {
            id: "ev-2",
            category: "STANDARD",
            ageGroup: "ADULT",
            competitionId: "comp-2",
          },
        },
        {
          id: "res-new",
          eventId: "ev-1",
          round: "FINAL",
          ranking: 1,
          details: { participant: "Alice Martin" },
          event: {
            id: "ev-1",
            category: "LATIN",
            ageGroup: "ADULT",
            competitionId: "comp-1",
          },
        },
      ] as never);
      prisma.competition.findMany.mockResolvedValue([
        { id: "comp-1", title: "Newer", date: new Date("2025-06-01") },
        { id: "comp-2", title: "Older", date: new Date("2024-01-01") },
      ] as never);

      const result = await service.getResultsForUser(
        "user-1",
        regs,
        "Alice",
        "Martin",
      );

      expect(result[0].id).toBe("res-new");
      expect(result[1].id).toBe("res-old");
    });
  });
});
