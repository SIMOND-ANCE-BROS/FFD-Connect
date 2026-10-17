import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { createMockPrismaService } from "../__mocks__/types";
import { clubPendingRegistrationSelect } from "../../utils/prisma-selects";
import {
  CLUB_COMPETITIONS_LIMIT,
  CLUB_PENDING_REGISTRATIONS_LIMIT,
  CompetitionQueryService,
} from "./competition-query.service";

const mockPrismaService = createMockPrismaService();
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  deleteByPattern: jest.fn(),
};

const mockCompetition = {
  id: "comp-1",
  ffdId: null,
  title: "Test Competition",
  date: new Date("2026-05-01"),
  location: "Paris",
  address: "1 rue de la Paix",
  zipCode: "75001",
  city: "Paris",
  latitude: 48.8566,
  longitude: 2.3522,
  description: null,
  type: null,
  competitionType: null,
  majorSubType: null,
  organizer: "Club Test",
  circularUrl: null,
  registrationUrl: null,
  ticketingUrl: null,
  layout: null,
  imageUrl: null,
  status: "UPCOMING",
  delayMinutes: 0,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  events: [],
  schedule: [],
};

describe("CompetitionQueryService", () => {
  let service: CompetitionQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionQueryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CompetitionQueryService>(CompetitionQueryService);
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(null);
    mockRedisService.delete.mockResolvedValue(null);
  });

  describe("findAll", () => {
    it("cache miss → calls prisma, caches result, returns paginated data", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        mockCompetition,
      ]);

      const result = await service.findAll();

      expect(mockPrismaService.competition.count).toHaveBeenCalled();
      expect(mockPrismaService.competition.findMany).toHaveBeenCalled();
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining("competitions:all:public"),
        expect.any(String),
        300,
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it("cache hit → returns parsed cache, does NOT call prisma", async () => {
      const cached = JSON.stringify({
        data: [mockCompetition],
        meta: { total: 1, skip: 0, take: 10, hasMore: false },
      });
      mockRedisService.get.mockResolvedValue(cached);

      const result = await service.findAll();

      expect(mockPrismaService.competition.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.competition.count).not.toHaveBeenCalled();
      expect(result.data[0].id).toBe("comp-1");
    });

    it("corrupted cache → evicts cache entry and falls through to prisma", async () => {
      mockRedisService.get.mockResolvedValue("not-valid-json{{");
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        mockCompetition,
      ]);

      const result = await service.findAll();

      expect(mockRedisService.delete).toHaveBeenCalledWith(
        expect.stringContaining("competitions:all:public"),
      );
      expect(mockPrismaService.competition.findMany).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });

    it("with userId → also calls prisma.user.findUnique for enrichment", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        {
          ...mockCompetition,
          events: [{ category: "Latin", ageGroup: "Adult", registrations: [] }],
        },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        category: "Latin",
        ageGroup: "Adult",
        role: "USER",
        clubId: null,
        clubName: null,
      });

      const result = await service.findAll("user-1");

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
      expect(result.data[0]).toHaveProperty("isRegistered");
      expect(result.data[0]).toHaveProperty("isEligible");
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining("competitions:all:user-1"),
        expect.any(String),
        300,
      );
    });

    it("without userId → returns public result without user enrichment", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(2);
      mockPrismaService.competition.findMany.mockResolvedValue([
        mockCompetition,
        { ...mockCompetition, id: "comp-2", title: "Second Competition" },
      ]);

      const result = await service.findAll();

      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it("with CLUB role user → also enriches competitions for organizer", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        {
          ...mockCompetition,
          events: [{ category: "Latin", ageGroup: "Adult", registrations: [] }],
        },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        category: "Latin",
        ageGroup: "Adult",
        role: "CLUB",
        clubId: "club-1",
        clubName: "Club Test",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);
      mockPrismaService.club.findMany.mockResolvedValue([]);

      const result = await service.findAll("user-club");

      expect(mockPrismaService.registration.findMany).toHaveBeenCalled();
      expect(result.data[0]).toHaveProperty("isOrganizedByMyClub");
      expect(result.data[0]).toHaveProperty("clubMembersRegisteredCount");
    });

    it("flags isOrganizedByMyClub on the organiser link, not the label (#408)", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(2);
      mockPrismaService.competition.findMany.mockResolvedValue([
        // Mine by id, label left stale by a rename.
        {
          ...mockCompetition,
          organizer: "Ancien Nom",
          organizerClubId: "club-1",
          events: [],
        },
        // Homonym club (case only): same label, other club.
        {
          ...mockCompetition,
          id: "comp-2",
          organizer: "club test",
          organizerClubId: "club-2",
          events: [],
        },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: "club-1",
        clubName: "Club Test",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);

      const result = await service.findAll("user-club");

      expect(
        result.data.map(
          (c: { isOrganizedByMyClub?: boolean }) => c.isOrganizedByMyClub,
        ),
      ).toEqual([true, false]);
    });

    it("flags an unlinked row only when its label designates exactly my club (#408)", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(2);
      mockPrismaService.competition.findMany.mockResolvedValue([
        {
          ...mockCompetition,
          organizer: "Club Test",
          organizerClubId: null,
          events: [],
        },
        {
          ...mockCompetition,
          id: "comp-2",
          organizer: "Club Homo",
          organizerClubId: null,
          events: [],
        },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: "club-1",
        clubName: "Club Homo",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1", name: "Club Test" },
        { id: "club-1", name: "Club Homo" },
        { id: "club-2", name: "club homo" },
      ] as never);

      const result = await service.findAll("user-club");

      expect(
        result.data.map(
          (c: { isOrganizedByMyClub?: boolean }) => c.isOrganizedByMyClub,
        ),
      ).toEqual([true, false]);
    });

    it("counts no member for a legacy account whose name designates homonym clubs (#749)", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        { ...mockCompetition, organizerClubId: "club-1", events: [] },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: "Club Test",
      });
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1" },
        { id: "club-2" },
      ]);

      const result = await service.findAll("user-club");

      expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          isOrganizedByMyClub: false,
          clubMembersRegisteredCount: 0,
        }),
      );
    });

    it("counts the resolved club's members for a legacy account (#749)", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(1);
      mockPrismaService.competition.findMany.mockResolvedValue([
        { ...mockCompetition, organizerClubId: "club-1", events: [] },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: "Club Test",
      });
      mockPrismaService.club.findMany.mockResolvedValue([{ id: "club-1" }]);
      mockPrismaService.club.findFirst.mockResolvedValue({ id: "club-1" });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { event: { competitionId: mockCompetition.id } },
      ]);

      const result = await service.findAll("user-club");

      expect(mockPrismaService.registration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              OR: [
                { clubId: "club-1" },
                {
                  clubId: null,
                  clubName: { equals: "Club Test", mode: "insensitive" },
                },
              ],
            },
          }),
        }),
      );
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          isOrganizedByMyClub: true,
          clubMembersRegisteredCount: 1,
        }),
      );
    });

    it("uses pagination parameters for cache key and query", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.count.mockResolvedValue(0);
      mockPrismaService.competition.findMany.mockResolvedValue([]);

      await service.findAll(undefined, { skip: 20, take: 5 });

      expect(mockPrismaService.competition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 5 }),
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        "competitions:all:public:20:5",
        expect.any(String),
        300,
      );
    });
  });

  describe("findOne", () => {
    it("cache miss → calls prisma.competition.findUnique, caches, returns competition", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.findUnique.mockResolvedValue(
        mockCompetition,
      );

      const result = await service.findOne("comp-1");

      expect(mockPrismaService.competition.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "comp-1" } }),
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        "competitions:one:comp-1",
        expect.any(String),
        300,
      );
      expect(result.id).toBe("comp-1");
    });

    it("cache hit → returns from cache without calling prisma", async () => {
      const cached = JSON.stringify(mockCompetition);
      mockRedisService.get.mockResolvedValue(cached);

      const result = await service.findOne("comp-1");

      expect(mockPrismaService.competition.findUnique).not.toHaveBeenCalled();
      expect(result.id).toBe("comp-1");
    });

    it("not found → throws NotFoundException", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockPrismaService.competition.findUnique.mockResolvedValue(null);

      await expect(service.findOne("unknown-id")).rejects.toThrow(
        new NotFoundException("Competition not found"),
      );
    });

    it("corrupted cache → evicts cache entry and falls through to prisma", async () => {
      mockRedisService.get.mockResolvedValue("{corrupted}}}");
      mockPrismaService.competition.findUnique.mockResolvedValue(
        mockCompetition,
      );

      const result = await service.findOne("comp-1");

      expect(mockRedisService.delete).toHaveBeenCalledWith(
        "competitions:one:comp-1",
      );
      expect(mockPrismaService.competition.findUnique).toHaveBeenCalled();
      expect(result.id).toBe("comp-1");
    });
  });

  describe("findOneForUser", () => {
    it("not found → throws NotFoundException", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue(null);

      await expect(
        service.findOneForUser("unknown-id", "user-1"),
      ).rejects.toThrow(new NotFoundException("Competition not found"));
    });

    it("user without ageGroup → all events have eligible: false with AGE_GROUP_REQUIRED", async () => {
      const competitionWithEvents = {
        ...mockCompetition,
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
        ],
      };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: null,
        category: "Latin",
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.events[0].eligibility.eligible).toBe(false);
      expect(result.events[0].eligibility.reason).toBe("AGE_GROUP_REQUIRED");
    });

    it("user with mismatched category → event has eligible: false with WRONG_CATEGORY", async () => {
      const competitionWithEvents = {
        ...mockCompetition,
        events: [
          {
            id: "e1",
            category: "Standard",
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
        ],
      };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: "Adult",
        category: "Latin",
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.events[0].eligibility.eligible).toBe(false);
      expect(result.events[0].eligibility.reason).toBe("WRONG_CATEGORY");
    });

    it("user with matching category and ageGroup → event has eligible: true", async () => {
      const competitionWithEvents = {
        ...mockCompetition,
        competitionType: "NATIONALE",
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
        ],
      };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: "Adult",
        category: "Latin",
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.events[0].eligibility.eligible).toBe(true);
      expect(result.events[0].eligibility.reason).toBeUndefined();
    });

    it("returns competition with events enriched with eligibility", async () => {
      const competitionWithEvents = {
        ...mockCompetition,
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
          {
            id: "e2",
            category: "Standard",
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
        ],
      };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: "Adult",
        category: "Latin",
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toHaveProperty("eligibility");
      expect(result.events[1]).toHaveProperty("eligibility");
      // Latin event is eligible, Standard is not (WRONG_CATEGORY)
      expect(result.events[0].eligibility.eligible).toBe(true);
      expect(result.events[1].eligibility.eligible).toBe(false);
      expect(result.events[1].eligibility.reason).toBe("WRONG_CATEGORY");
    });

    it("user with null ageGroup and null category → eligible: false", async () => {
      const competitionWithEvents = {
        ...mockCompetition,
        events: [
          {
            id: "e1",
            category: null,
            ageGroup: "Adult",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
          },
        ],
      };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: null,
        category: null,
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.events[0].eligibility.eligible).toBe(false);
      expect(result.events[0].eligibility.reason).toBe("AGE_GROUP_REQUIRED");
    });

    it("spreads all competition base fields onto returned object", async () => {
      const competitionWithEvents = { ...mockCompetition, events: [] };
      mockPrismaService.competition.findUnique.mockResolvedValue(
        competitionWithEvents,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ageGroup: "Adult",
        category: "Latin",
      });

      const result = await service.findOneForUser("comp-1", "user-1");

      expect(result.id).toBe("comp-1");
      expect(result.title).toBe("Test Competition");
      expect(result.location).toBe("Paris");
    });
  });

  describe("findActiveCompetition", () => {
    it("delegates to prisma.competition.findFirst with today's date range", async () => {
      mockPrismaService.competition.findFirst.mockResolvedValue(
        mockCompetition,
      );

      const result = await service.findActiveCompetition();

      expect(mockPrismaService.competition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            date: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          },
        }),
      );
      expect(result).toEqual(mockCompetition);
    });

    it("uses midnight boundaries for today's date range", async () => {
      mockPrismaService.competition.findFirst.mockResolvedValue(null);

      await service.findActiveCompetition();

      const call = mockPrismaService.competition.findFirst.mock.calls[0][0] as {
        where: { date: { gte: Date; lt: Date } };
      };
      const { gte, lt } = call.where.date;

      // gte should be start of today (midnight)
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
      expect(gte.getSeconds()).toBe(0);

      // lt should be start of tomorrow (exactly 24h after gte)
      const diffMs = lt.getTime() - gte.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
    });

    it("returns null when no active competition found", async () => {
      mockPrismaService.competition.findFirst.mockResolvedValue(null);

      const result = await service.findActiveCompetition();

      expect(result).toBeNull();
    });
  });

  describe("getPendingRegistrationsForClub", () => {
    it("returns empty array when organizer is not CLUB role", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "LICENSEE",
        clubId: "club-1",
        clubName: null,
      });

      const result = await service.getPendingRegistrationsForClub("user-1");

      expect(result).toEqual([]);
    });

    it("accepts a licensee whose CLUB role is an extra role", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "LICENSEE",
        extraRoles: ["CLUB"],
        clubId: "club-1",
        clubName: null,
        club: { disabledAt: null },
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);

      const result = await service.getPendingRegistrationsForClub("user-1");

      expect(result).toEqual([]);
      expect(mockPrismaService.registration.findMany).toHaveBeenCalled();
    });

    it("returns empty array for an extra CLUB role of a disabled club", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "LICENSEE",
        extraRoles: ["CLUB"],
        clubId: "club-1",
        clubName: null,
        club: { disabledAt: new Date() },
      });

      const result = await service.getPendingRegistrationsForClub("user-1");

      expect(result).toEqual([]);
      expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
    });

    it("returns empty array when organizer has no club", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: null,
      });

      const result = await service.getPendingRegistrationsForClub("user-1");

      expect(result).toEqual([]);
    });

    it("returns pending registrations with competition info", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: "club-1",
        clubName: null,
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        {
          id: "reg-1",
          status: "PENDING",
          user: {
            id: "user-1",
            firstName: "Alice",
            lastName: "Martin",
            email: "alice@example.com",
            clubName: null,
          },
          event: {
            id: "event-1",
            category: "Adultes",
            ageGroup: null,
            eventType: "STANDARD",
            competitionId: "comp-1",
          },
        },
      ]);
      mockPrismaService.competition.findMany.mockResolvedValue([
        {
          id: "comp-1",
          title: "Championnat 2026",
          date: new Date("2026-06-01"),
        },
      ]);

      const result =
        await service.getPendingRegistrationsForClub("organizer-1");

      expect(result).toHaveLength(1);
      expect(result[0].competition).toEqual(
        expect.objectContaining({ id: "comp-1", title: "Championnat 2026" }),
      );
    });

    it("reads the most recent pending registrations through the shared select, bounded (#753)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: "club-1",
        clubName: null,
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);

      await service.getPendingRegistrationsForClub("organizer-1");

      const query = mockPrismaService.registration.findMany.mock.calls[0][0];
      expect(query).toEqual({
        where: expect.objectContaining({ status: "PENDING" }),
        select: clubPendingRegistrationSelect,
        orderBy: { createdAt: "desc" },
        take: CLUB_PENDING_REGISTRATIONS_LIMIT,
      });
      expect(query).not.toHaveProperty("include");
      expect(CLUB_PENDING_REGISTRATIONS_LIMIT).toBe(500);
      // No competition lookup without a registration.
      expect(mockPrismaService.competition.findMany).not.toHaveBeenCalled();
    });

    it("scopes a legacy account (no clubId) to the one active club its name designates (#749)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: " Club_Test ",
      });
      mockPrismaService.club.findMany.mockResolvedValue([{ id: "club-1" }]);
      mockPrismaService.club.findFirst.mockResolvedValue({ id: "club-1" });
      mockPrismaService.registration.findMany.mockResolvedValue([]);

      await service.getPendingRegistrationsForClub("organizer-1");

      expect(mockPrismaService.registration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "PENDING",
            user: {
              OR: [
                { clubId: "club-1" },
                {
                  clubId: null,
                  // LIKE metacharacters escaped: « _ » is not a wildcard.
                  clubName: { equals: "Club\\_Test", mode: "insensitive" },
                },
              ],
            },
          },
        }),
      );
    });

    it("returns nothing for a legacy account whose name designates homonym clubs (#749)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: "Club Test",
      });
      // « Club Test » and « club test »: never guessed.
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1" },
        { id: "club-2" },
      ]);

      const result =
        await service.getPendingRegistrationsForClub("organizer-1");

      expect(result).toEqual([]);
      expect(mockPrismaService.registration.findMany).not.toHaveBeenCalled();
    });
  });

  describe("findOrganizedByClub", () => {
    it("returns the competitions linked to the club, or unlinked with its name, bounded (#408)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        extraRoles: [],
        clubId: "club-1",
        clubName: " Club Test ",
        club: { disabledAt: null, name: "Club Test" },
      });
      const homonymRow = {
        ...mockCompetition,
        id: "comp-homonym",
        organizer: "club homo",
      };
      mockPrismaService.competition.findMany.mockResolvedValue([
        mockCompetition,
        homonymRow,
      ]);
      // "Club Test" is mine alone; "club homo" is shared by two clubs.
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1", name: "Club Test" },
        { id: "club-1", name: "Club Homo" },
        { id: "club-2", name: "club homo" },
      ] as never);

      const result = await service.findOrganizedByClub("user-1");

      // Unlinked rows kept only when the label designates exactly my club.
      expect(result).toEqual([mockCompetition]);
      expect(mockPrismaService.competition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { organizerClubId: "club-1" },
              {
                organizerClubId: null,
                organizer: { equals: "Club Test", mode: "insensitive" },
              },
            ],
          },
          orderBy: { date: "desc" },
          take: CLUB_COMPETITIONS_LIMIT,
          select: expect.objectContaining({ id: true, layout: true }),
        }),
      );
    });

    it("ignores a stale User.clubName for a linked account (#625)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: "club-1",
        clubName: "Ancien Nom",
        club: { disabledAt: null, name: "Club Test" },
      });
      mockPrismaService.competition.findMany.mockResolvedValue([]);

      await service.findOrganizedByClub("user-1");

      expect(mockPrismaService.competition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { organizerClubId: "club-1" },
              {
                organizerClubId: null,
                organizer: { equals: "Club Test", mode: "insensitive" },
              },
            ],
          },
        }),
      );
    });

    it("resolves a legacy account (no clubId) to the one club its name designates (#625)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: "Club Test",
        club: null,
      });
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1" },
      ] as never);
      // The club is active.
      mockPrismaService.club.findFirst.mockResolvedValue({ id: "club-1" });
      mockPrismaService.competition.findMany.mockResolvedValue([]);

      await service.findOrganizedByClub("user-1");

      expect(mockPrismaService.competition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { organizerClubId: "club-1" },
              {
                organizerClubId: null,
                organizer: { equals: "Club Test", mode: "insensitive" },
              },
            ],
          },
        }),
      );
    });

    it("lists nothing for a legacy account whose name is shared by homonym clubs (#625)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: "CLUB",
        clubId: null,
        clubName: "Club Homo",
        club: null,
      });
      mockPrismaService.club.findMany.mockResolvedValue([
        { id: "club-1" },
        { id: "club-2" },
      ] as never);

      await expect(service.findOrganizedByClub("user-1")).resolves.toEqual([]);
      expect(mockPrismaService.competition.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ["an unknown account", null],
      [
        "an account without the CLUB role",
        { role: "LICENSEE", clubName: "Club Test" },
      ],
      [
        "an extra CLUB role of a disabled club",
        {
          role: "LICENSEE",
          extraRoles: ["CLUB"],
          clubName: null,
          club: { disabledAt: new Date(), name: "Club Test" },
        },
      ],
      [
        "a CLUB account without a club",
        { role: "CLUB", clubName: "  ", club: null },
      ],
    ])("returns an empty list for %s", async (_label, user) => {
      mockPrismaService.user.findUnique.mockResolvedValue(user);

      const result = await service.findOrganizedByClub("user-1");

      expect(result).toEqual([]);
      expect(mockPrismaService.competition.findMany).not.toHaveBeenCalled();
    });
  });
});
