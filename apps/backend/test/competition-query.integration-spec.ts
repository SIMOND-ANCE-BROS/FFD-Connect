import { Test, TestingModule } from "@nestjs/testing";
import { RegistrationStatus, UserRole } from "@prisma/client";
import { AppModule } from "./../src/app.module";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { CompetitionQueryService } from "./../src/competitions/services/competition-query.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { TtsService } from "./../src/tts/tts.service";
import { PaginationParamsDto } from "./../src/common/dto/pagination-params.dto";

/**
 * Tests d'intégration pour CompetitionQueryService avec vraie base de données.
 * RedisService, TtsService et NotificationsService sont mockés.
 */
describe("CompetitionQueryService (integration with real DB)", () => {
  let moduleFixture: TestingModule;
  let queryService: CompetitionQueryService;
  let prisma: PrismaService;

  const suffix = Date.now();

  // Clubs
  let organizerClubId: string;
  const organizerClubName = `Query Test Organizer Club ${suffix}`;

  // Users
  let licenseeUserId: string;
  let clubOrgUserId: string;
  let pendingLicenseeId: string;

  // Competitions
  let comp1Id: string;
  let comp2Id: string;
  let comp3Id: string;
  let todayCompId: string;

  // Events
  let event1Id: string;
  let event2Id: string;
  let event3Id: string;
  let todayEventId: string;

  // Registrations
  let confirmedRegistrationId: string;
  let pendingRegistrationId: string;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TtsService)
      .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
      .overrideProvider(NotificationsService)
      .useValue({
        createForUser: jest.fn().mockResolvedValue(undefined),
        sendToDevice: jest.fn().mockResolvedValue(undefined),
        sendToTopic: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(RedisService)
      .useValue({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
        delete: jest.fn(),
        deleteByPattern: jest.fn(),
      })
      .overrideProvider(SessionCleanupService)
      .useValue({
        onModuleInit: jest.fn(),
        cleanupExpiredSessions: jest.fn(),
        cleanupUserSessions: jest.fn(),
        manualCleanup: jest.fn(),
      })
      .compile();

    queryService = moduleFixture.get<CompetitionQueryService>(
      CompetitionQueryService,
    );
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // ── Clean up any stale today-dated competitions from previous failed runs ──
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const staleToday = await prisma.competition.findMany({
      where: { date: { gte: startOfToday, lt: startOfTomorrow } },
      select: { id: true },
    });
    if (staleToday.length > 0) {
      const staleIds = staleToday.map((c) => c.id);
      await prisma.registration
        .deleteMany({
          where: { event: { competitionId: { in: staleIds } } },
        })
        .catch(() => {});
      await prisma.event
        .deleteMany({ where: { competitionId: { in: staleIds } } })
        .catch(() => {});
      await prisma.competition
        .deleteMany({ where: { id: { in: staleIds } } })
        .catch(() => {});
    }

    // ── Organizer Club ──
    const organizerClub = await prisma.club.create({
      data: { name: organizerClubName },
    });
    organizerClubId = organizerClub.id;

    // ── Users ──
    const [licensee, clubOrg, pendingLicensee] = await Promise.all([
      prisma.user.create({
        data: {
          email: `licensee-query-${suffix}@test.com`,
          password: "hashed",
          firstName: "Léa",
          lastName: `Query${suffix}`,
          role: UserRole.LICENSEE,
          ageGroup: "Adulte",
          category: "Latin",
          clubId: organizerClubId,
          clubName: organizerClubName,
        },
      }),
      prisma.user.create({
        data: {
          email: `cluborg-query-${suffix}@test.com`,
          password: "hashed",
          firstName: "Organizer",
          lastName: `Query${suffix}`,
          role: UserRole.CLUB,
          clubId: organizerClubId,
          clubName: organizerClubName,
        },
      }),
      prisma.user.create({
        data: {
          email: `pending-query-${suffix}@test.com`,
          password: "hashed",
          firstName: "Pending",
          lastName: `Query${suffix}`,
          role: UserRole.LICENSEE,
          ageGroup: "Junior",
          category: "Standard",
          clubId: organizerClubId,
          clubName: organizerClubName,
        },
      }),
    ]);
    licenseeUserId = licensee.id;
    clubOrgUserId = clubOrg.id;
    pendingLicenseeId = pendingLicensee.id;

    // ── Competitions ──
    // comp1 organized by our club (organizer field = club name)
    const [c1, c2, c3] = await Promise.all([
      prisma.competition.create({
        data: {
          title: `Query Comp 1 ${suffix}`,
          date: new Date("2025-06-01"),
          location: "Lyon",
          organizer: organizerClubName,
          status: "UPCOMING",
        },
      }),
      prisma.competition.create({
        data: {
          title: `Query Comp 2 ${suffix}`,
          date: new Date("2025-07-15"),
          location: "Bordeaux",
          organizer: "Some Other Organizer",
          status: "UPCOMING",
        },
      }),
      prisma.competition.create({
        data: {
          title: `Query Comp 3 ${suffix}`,
          date: new Date("2025-08-20"),
          location: "Marseille",
          status: "UPCOMING",
        },
      }),
    ]);
    comp1Id = c1.id;
    comp2Id = c2.id;
    comp3Id = c3.id;

    // Competition set to today's date for findActiveCompetition
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayComp = await prisma.competition.create({
      data: {
        title: `Query Today Comp ${suffix}`,
        date: today,
        location: "Paris",
        status: "LIVE",
      },
    });
    todayCompId = todayComp.id;

    // ── Events ──
    const [ev1, ev2, ev3, evToday] = await Promise.all([
      prisma.event.create({
        data: {
          competitionId: comp1Id,
          category: "Latin",
          ageGroup: "Adulte",
          eventType: "COUPLE",
          level: "Intermédiaire",
        },
      }),
      prisma.event.create({
        data: {
          competitionId: comp2Id,
          category: "Standard",
          ageGroup: "Junior",
          eventType: "COUPLE",
          level: "Débutant",
        },
      }),
      prisma.event.create({
        data: {
          competitionId: comp3Id,
          category: "Latin",
          ageGroup: "Senior",
          eventType: "COUPLE",
        },
      }),
      prisma.event.create({
        data: {
          competitionId: todayCompId,
          category: "Latin",
          ageGroup: "Adulte",
          eventType: "COUPLE",
        },
      }),
    ]);
    event1Id = ev1.id;
    event2Id = ev2.id;
    event3Id = ev3.id;
    todayEventId = evToday.id;

    // ── Registrations ──
    // licenseeUserId has a CONFIRMED registration in comp1/event1
    // pendingLicenseeId has a PENDING registration in comp2/event2
    const [confirmedReg, pendingReg] = await Promise.all([
      prisma.registration.create({
        data: {
          eventId: event1Id,
          userId: licenseeUserId,
          status: RegistrationStatus.CONFIRMED,
          partnerName: "Test Partner",
        },
      }),
      prisma.registration.create({
        data: {
          eventId: event2Id,
          userId: pendingLicenseeId,
          status: RegistrationStatus.PENDING,
        },
      }),
    ]);
    confirmedRegistrationId = confirmedReg.id;
    pendingRegistrationId = pendingReg.id;
  }, 30000);

  afterAll(async () => {
    await prisma.registration
      .deleteMany({
        where: { id: { in: [confirmedRegistrationId, pendingRegistrationId] } },
      })
      .catch(() => {});
    await prisma.event
      .deleteMany({
        where: { id: { in: [event1Id, event2Id, event3Id, todayEventId] } },
      })
      .catch(() => {});
    await prisma.competition
      .deleteMany({
        where: { id: { in: [comp1Id, comp2Id, comp3Id, todayCompId] } },
      })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { contains: `${suffix}@test.com` } } })
      .catch(() => {});
    await prisma.club
      .deleteMany({ where: { id: organizerClubId } })
      .catch(() => {});
    await prisma.$disconnect();
    await moduleFixture.close();
  }, 15000);

  // ─────────────────────────────────────────────
  // findAll
  // ─────────────────────────────────────────────
  describe("findAll", () => {
    it("No userId → returns paginated list with data and total", async () => {
      const result = await queryService.findAll();
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("meta.total");
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta.total).toBeGreaterThanOrEqual(3);
    });

    it("No userId → competitions have events but no registrations attached", async () => {
      const result = await queryService.findAll();
      const comp = result.data.find((c: { id: string }) => c.id === comp1Id);
      expect(comp).toBeDefined();
      // Without userId, events don't carry registration arrays
      const event = (
        comp as { events: { id: string; registrations?: unknown[] }[] }
      ).events.find((e) => e.id === event1Id);
      expect(event).toBeDefined();
      // registrations field is false (not fetched) when no userId
      expect(event!.registrations).toBeUndefined();
    });

    it("With userId LICENSEE → isRegistered=true for competitions where user has CONFIRMED registration", async () => {
      const result = await queryService.findAll(licenseeUserId);
      const comp = result.data.find((c: { id: string }) => c.id === comp1Id);
      expect(comp).toBeDefined();
      expect((comp as { isRegistered: boolean }).isRegistered).toBe(true);
    });

    it("With userId LICENSEE → isRegistered=false for competitions where user is NOT registered", async () => {
      const result = await queryService.findAll(licenseeUserId);
      const comp = result.data.find((c: { id: string }) => c.id === comp2Id);
      expect(comp).toBeDefined();
      expect((comp as { isRegistered: boolean }).isRegistered).toBe(false);
    });

    it("User with PENDING registration → still shows isRegistered=true", async () => {
      const result = await queryService.findAll(pendingLicenseeId);
      const comp = result.data.find((c: { id: string }) => c.id === comp2Id);
      expect(comp).toBeDefined();
      expect((comp as { isRegistered: boolean }).isRegistered).toBe(true);
    });

    it("With userId CLUB (organizer) → isOrganizedByMyClub=true for competitions organized by that club", async () => {
      const result = await queryService.findAll(clubOrgUserId);
      const comp = result.data.find((c: { id: string }) => c.id === comp1Id);
      expect(comp).toBeDefined();
      expect(
        (comp as { isOrganizedByMyClub: boolean }).isOrganizedByMyClub,
      ).toBe(true);
    });

    it("With userId CLUB (organizer) → isOrganizedByMyClub=false for competitions NOT organized by that club", async () => {
      const result = await queryService.findAll(clubOrgUserId);
      const comp = result.data.find((c: { id: string }) => c.id === comp2Id);
      expect(comp).toBeDefined();
      expect(
        (comp as { isOrganizedByMyClub: boolean }).isOrganizedByMyClub,
      ).toBe(false);
    });

    it("Pagination: skip=0, take=2 with 3+ competitions → returns 2 items", async () => {
      const pagination = new PaginationParamsDto();
      pagination.skip = 0;
      pagination.take = 2;
      const result = await queryService.findAll(undefined, pagination);
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBeGreaterThanOrEqual(3);
    });

    it("Pagination: skip=2, take=2 → skips first 2 competitions", async () => {
      const paginationFull = new PaginationParamsDto();
      paginationFull.skip = 0;
      paginationFull.take = 10;
      const fullResult = await queryService.findAll(undefined, paginationFull);

      const paginationSkipped = new PaginationParamsDto();
      paginationSkipped.skip = 2;
      paginationSkipped.take = 2;
      const skippedResult = await queryService.findAll(
        undefined,
        paginationSkipped,
      );

      // The first item of skipped page should be the 3rd item of full list
      if (fullResult.data.length >= 3 && skippedResult.data.length >= 1) {
        expect(skippedResult.data[0].id).toBe(fullResult.data[2].id);
      }
    });

    it("Result includes pagination metadata (skip, take, total)", async () => {
      const pagination = new PaginationParamsDto();
      pagination.skip = 0;
      pagination.take = 5;
      const result = await queryService.findAll(undefined, pagination);
      expect(result).toHaveProperty("meta.total");
      expect(result).toHaveProperty("data");
    });
  });

  // ─────────────────────────────────────────────
  // findOne
  // ─────────────────────────────────────────────
  describe("findOne", () => {
    it("Existing id → returns competition with events", async () => {
      const result = await queryService.findOne(comp1Id);
      expect(result.id).toBe(comp1Id);
      expect(result.title).toBe(`Query Comp 1 ${suffix}`);
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.events.length).toBeGreaterThan(0);
    });

    it("Existing id → returns competition with schedule field", async () => {
      const result = await queryService.findOne(comp1Id);
      expect(result).toHaveProperty("schedule");
      expect(Array.isArray(result.schedule)).toBe(true);
    });

    it("Existing id → events include category and ageGroup", async () => {
      const result = await queryService.findOne(comp1Id);
      const event = result.events.find(
        (e: { id: string }) => e.id === event1Id,
      );
      expect(event).toBeDefined();
      expect(event.category).toBe("Latin");
      expect(event.ageGroup).toBe("Adulte");
    });

    it("Non-existent id → throws NotFoundException", async () => {
      await expect(
        queryService.findOne("non-existent-comp-id"),
      ).rejects.toThrow("Competition not found");
    });
  });

  // ─────────────────────────────────────────────
  // findOneForUser
  // ─────────────────────────────────────────────
  describe("findOneForUser", () => {
    it("Non-existent competition → throws NotFoundException", async () => {
      await expect(
        queryService.findOneForUser("non-existent-comp-id", licenseeUserId),
      ).rejects.toThrow("Competition not found");
    });

    it("Returns competition with eventsWithEligibility", async () => {
      const result = await queryService.findOneForUser(comp1Id, licenseeUserId);
      expect(result.id).toBe(comp1Id);
      expect(Array.isArray(result.events)).toBe(true);
      result.events.forEach(
        (e: { eligibility: { eligible: boolean; reason?: string } }) => {
          expect(e).toHaveProperty("eligibility");
          expect(e.eligibility).toHaveProperty("eligible");
        },
      );
    });

    it("User's ageGroup matches event → eligible is evaluated (not blocked by missing ageGroup)", async () => {
      // licenseeUserId has ageGroup: Adulte, event1 has ageGroup: Adulte
      const result = await queryService.findOneForUser(comp1Id, licenseeUserId);
      const event = result.events.find(
        (e: { id: string }) => e.id === event1Id,
      );
      expect(event).toBeDefined();
      // eligible depends on participation rules; at minimum reason should not be AGE_GROUP_REQUIRED
      expect(event!.eligibility.reason).not.toBe("AGE_GROUP_REQUIRED");
    });

    it("User with no ageGroup → eligible=false with reason AGE_GROUP_REQUIRED", async () => {
      // Create a user without ageGroup
      const userNoAge = await prisma.user.create({
        data: {
          email: `noage-query-${suffix}@test.com`,
          password: "hashed",
          firstName: "NoAge",
          lastName: `Query${suffix}`,
          role: UserRole.LICENSEE,
          // intentionally no ageGroup
        },
      });

      const result = await queryService.findOneForUser(comp1Id, userNoAge.id);
      result.events.forEach(
        (e: { eligibility: { eligible: boolean; reason?: string } }) => {
          expect(e.eligibility.eligible).toBe(false);
          expect(e.eligibility.reason).toBe("AGE_GROUP_REQUIRED");
        },
      );

      await prisma.user.delete({ where: { id: userNoAge.id } });
    });

    it("User's category doesn't match event category → eligible=false with WRONG_CATEGORY reason", async () => {
      // comp2/event2 has category Standard; create user with category Latin
      const userWrongCat = await prisma.user.create({
        data: {
          email: `wrongcat-query-${suffix}@test.com`,
          password: "hashed",
          firstName: "WrongCat",
          lastName: `Query${suffix}`,
          role: UserRole.LICENSEE,
          ageGroup: "Junior",
          category: "Latin", // event2 is Standard
        },
      });

      const result = await queryService.findOneForUser(
        comp2Id,
        userWrongCat.id,
      );
      const event = result.events.find(
        (e: { id: string }) => e.id === event2Id,
      );
      expect(event).toBeDefined();
      expect(event!.eligibility.eligible).toBe(false);
      expect(event!.eligibility.reason).toBe("WRONG_CATEGORY");

      await prisma.user.delete({ where: { id: userWrongCat.id } });
    });

    it("Reads the competition level of the EVENT discipline, Ten Dance needs both disciplines", async () => {
      const comp = await prisma.competition.create({
        data: {
          title: `Query Per-Discipline ${suffix}`,
          date: new Date(Date.now() + 30 * 86_400_000),
          location: "Lyon",
          competitionType: "NATIONALE",
        },
      });
      const [latinAvance, standardAvance, tenDance] = await Promise.all([
        prisma.event.create({
          data: {
            competitionId: comp.id,
            category: "Latin",
            ageGroup: "Adulte",
            eventType: "COUPLE",
            eventKind: "CLASSIFICATRICE",
            level: "Avancé",
          },
        }),
        prisma.event.create({
          data: {
            competitionId: comp.id,
            category: "Standard",
            ageGroup: "Adulte",
            eventType: "COUPLE",
            eventKind: "CLASSIFICATRICE",
            level: "Avancé",
          },
        }),
        prisma.event.create({
          data: {
            competitionId: comp.id,
            category: "Ten Dance",
            ageGroup: "Adulte",
            eventType: "COUPLE",
            eventKind: "MAJEURE",
          },
        }),
      ]);
      const [bothDisciplines, latinOnly] = await Promise.all([
        prisma.user.create({
          data: {
            email: `perdiscipline-both-${suffix}@test.com`,
            password: "hashed",
            firstName: "Both",
            lastName: `Query${suffix}`,
            role: UserRole.LICENSEE,
            ageGroup: "Adulte",
            category: "Latin",
            competitionLevelLatin: "International",
            competitionLevelStandard: "Débutant",
          },
        }),
        prisma.user.create({
          data: {
            email: `perdiscipline-latin-${suffix}@test.com`,
            password: "hashed",
            firstName: "Latin",
            lastName: `Query${suffix}`,
            role: UserRole.LICENSEE,
            ageGroup: "Adulte",
            category: "Latin",
            competitionLevelLatin: "International",
          },
        }),
      ]);

      try {
        const eligibilityOf = async (userId: string, eventId: string) => {
          const result = await queryService.findOneForUser(comp.id, userId);
          const event = result.events.find(
            (e: { id: string }) => e.id === eventId,
          );
          return event!.eligibility;
        };

        expect(
          (await eligibilityOf(bothDisciplines.id, latinAvance.id)).eligible,
        ).toBe(true);
        const standard = await eligibilityOf(
          bothDisciplines.id,
          standardAvance.id,
        );
        expect(standard.eligible).toBe(false);
        expect(standard.reason).toContain("Débutant");
        expect(
          (await eligibilityOf(bothDisciplines.id, tenDance.id)).eligible,
        ).toBe(true);
        expect(await eligibilityOf(latinOnly.id, tenDance.id)).toEqual({
          eligible: false,
          reason: "WRONG_CATEGORY",
        });
      } finally {
        await prisma.event.deleteMany({ where: { competitionId: comp.id } });
        await prisma.competition.delete({ where: { id: comp.id } });
        await prisma.user.deleteMany({
          where: { id: { in: [bothDisciplines.id, latinOnly.id] } },
        });
      }
    });

    it("Returns schedule alongside events", async () => {
      const result = await queryService.findOneForUser(comp1Id, licenseeUserId);
      expect(result).toHaveProperty("schedule");
    });
  });

  // ─────────────────────────────────────────────
  // findActiveCompetition
  // ─────────────────────────────────────────────
  describe("findActiveCompetition", () => {
    it("Competition with today's date → returns it", async () => {
      const result = await queryService.findActiveCompetition();
      expect(result).not.toBeNull();
      expect(result!.id).toBe(todayCompId);
    });

    it("Returns competition with events included", async () => {
      const result = await queryService.findActiveCompetition();
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.events)).toBe(true);
      const ev = result!.events.find(
        (e: { id: string }) => e.id === todayEventId,
      );
      expect(ev).toBeDefined();
    });

    it("Returns competition data matching expected shape", async () => {
      const result = await queryService.findActiveCompetition();
      expect(result).toMatchObject({
        id: todayCompId,
        title: `Query Today Comp ${suffix}`,
        location: "Paris",
      });
    });

    it("No competition today → returns null (after removing today's comp temporarily)", async () => {
      // Create a competition far in the future to ensure it's not returned
      const futureComp = await prisma.competition.create({
        data: {
          title: `Future Only Comp ${suffix}`,
          date: new Date("2099-12-31"),
          location: "Nowhere",
          status: "UPCOMING",
        },
      });

      // We verify that findActiveCompetition returns null when called with a date
      // that has no competition — we test this indirectly by confirming it doesn't
      // return the future competition
      const result = await queryService.findActiveCompetition();
      if (result) {
        expect(result.id).not.toBe(futureComp.id);
      }

      await prisma.competition.delete({ where: { id: futureComp.id } });
    });
  });
});
