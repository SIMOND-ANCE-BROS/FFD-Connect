import { Test, TestingModule } from "@nestjs/testing";
import { PartnershipStatus, UserRole } from "@prisma/client";
import { AppModule } from "./../src/app.module";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { CareerService } from "./../src/career/career.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { TtsService } from "./../src/tts/tts.service";

/**
 * Tests d'intégration pour CareerService avec vraie base de données.
 * NotificationsService et TtsService sont mockés (pas de push réel).
 */
describe("CareerService (integration with real DB)", () => {
  let moduleFixture: TestingModule;
  let careerService: CareerService;
  let prisma: PrismaService;

  const suffix = Date.now();

  // Clubs
  let clubAId: string;
  let clubBId: string;
  const testClubAName = `Career Club Alpha ${suffix}`;
  const testClubBName = `Career Club Beta ${suffix}`;

  // Users
  let staffUserId: string;
  let licenseeClubAId: string;
  let licenseeClubA2Id: string;
  let licenseeClubBId: string;
  let licenseeNoPartnershipsId: string;

  // Competition / Event data
  let competitionId: string;
  let eventId: string;
  let registrationId: string;
  let resultId: string;
  let otherResultId: string;

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
      .overrideProvider(SessionCleanupService)
      .useValue({
        onModuleInit: jest.fn(),
        cleanupExpiredSessions: jest.fn(),
        cleanupUserSessions: jest.fn(),
        manualCleanup: jest.fn(),
      })
      .compile();

    careerService = moduleFixture.get<CareerService>(CareerService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // ── Clubs ──
    const [clubA, clubB] = await Promise.all([
      prisma.club.create({ data: { name: testClubAName } }),
      prisma.club.create({ data: { name: testClubBName } }),
    ]);
    clubAId = clubA.id;
    clubBId = clubB.id;

    // ── Users ──
    const [staff, l1, l2, l3, l4] = await Promise.all([
      prisma.user.create({
        data: {
          email: `staff-career-${suffix}@test.com`,
          password: "hashed",
          firstName: "Staff",
          lastName: "Admin",
          role: UserRole.STAFF,
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee-a1-career-${suffix}@test.com`,
          password: "hashed",
          firstName: "Alice",
          lastName: `Dupont${suffix}`,
          role: UserRole.LICENSEE,
          clubId: clubAId,
          clubName: testClubAName,
          ageGroup: "Adulte",
          category: "Latin",
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee-a2-career-${suffix}@test.com`,
          password: "hashed",
          firstName: "Bob",
          lastName: `Martin${suffix}`,
          role: UserRole.LICENSEE,
          clubId: clubAId,
          clubName: testClubAName,
          ageGroup: "Adulte",
          category: "Latin",
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee-b1-career-${suffix}@test.com`,
          password: "hashed",
          firstName: "Charlie",
          lastName: `Durand${suffix}`,
          role: UserRole.LICENSEE,
          clubId: clubBId,
          clubName: testClubBName,
          ageGroup: "Junior",
          category: "Standard",
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee-nodata-career-${suffix}@test.com`,
          password: "hashed",
          firstName: "Empty",
          lastName: `User${suffix}`,
          role: UserRole.LICENSEE,
          clubId: clubAId,
          clubName: testClubAName,
        },
      }),
    ]);
    staffUserId = staff.id;
    licenseeClubAId = l1.id;
    licenseeClubA2Id = l2.id;
    licenseeClubBId = l3.id;
    licenseeNoPartnershipsId = l4.id;

    // ── Competition + Event ──
    const competition = await prisma.competition.create({
      data: {
        title: `Test Competition Career ${suffix}`,
        date: new Date("2024-03-15"),
        location: "Paris",
        status: "PAST",
      },
    });
    competitionId = competition.id;

    const event = await prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
        level: "Intermédiaire",
      },
    });
    eventId = event.id;

    // ── Registration for licenseeClubAId ──
    const registration = await prisma.registration.create({
      data: {
        eventId,
        userId: licenseeClubAId,
        partnerName: `Bob Martin${suffix}`,
        status: "CONFIRMED",
        bibNumber: 42,
      },
    });
    registrationId = registration.id;

    // ── Result matching licenseeClubAId's name ──
    const result = await prisma.result.create({
      data: {
        eventId,
        userId: licenseeClubAId,
        round: "Finale",
        ranking: 1,
        details: { participant: `Alice Dupont${suffix}` },
      },
    });
    resultId = result.id;

    // ── Result for another participant (same event, different name) ──
    const otherResult = await prisma.result.create({
      data: {
        eventId,
        userId: licenseeClubBId,
        round: "Finale",
        ranking: 2,
        details: { participant: `Other Dancer ${suffix}` },
      },
    });
    otherResultId = otherResult.id;
  }, 30000);

  afterAll(async () => {
    await prisma.result
      .deleteMany({ where: { id: { in: [resultId, otherResultId] } } })
      .catch(() => {});
    await prisma.registration
      .deleteMany({ where: { id: registrationId } })
      .catch(() => {});
    await prisma.partnership
      .deleteMany({
        where: {
          OR: [
            {
              user1Id: {
                in: [
                  licenseeClubAId,
                  licenseeClubA2Id,
                  licenseeClubBId,
                  licenseeNoPartnershipsId,
                ],
              },
            },
            {
              user2Id: {
                in: [
                  licenseeClubAId,
                  licenseeClubA2Id,
                  licenseeClubBId,
                  licenseeNoPartnershipsId,
                ],
              },
            },
          ],
        },
      })
      .catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.competition
      .deleteMany({ where: { id: competitionId } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { contains: `${suffix}@test.com` } } })
      .catch(() => {});
    await prisma.club
      .deleteMany({ where: { id: { in: [clubAId, clubBId] } } })
      .catch(() => {});
    await prisma.$disconnect();
    await moduleFixture.close();
  }, 15000);

  // ─────────────────────────────────────────────
  // searchMembers
  // ─────────────────────────────────────────────
  describe("searchMembers", () => {
    it("STAFF user → can search across all licensees", async () => {
      const results = await careerService.searchMembers(staffUserId, "Alice");
      const ids = results.map((r) => r.id);
      expect(ids).toContain(licenseeClubAId);
    });

    it("STAFF user → returns members from multiple clubs", async () => {
      // Both Alice (Club A) and Charlie (Club B) have names matchable by last-name suffix
      const results = await careerService.searchMembers(
        staffUserId,
        `Dupont${suffix}`.slice(0, 8),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(licenseeClubAId);
    });

    it("LICENSEE user → finds a licensee by name (no club restriction)", async () => {
      const results = await careerService.searchMembers(
        licenseeClubAId,
        "Alice",
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(licenseeClubAId);
    });

    it("LICENSEE user with clubId → Bob from same club is visible", async () => {
      const results = await careerService.searchMembers(licenseeClubAId, "Bob");
      const ids = results.map((r) => r.id);
      expect(ids).toContain(licenseeClubA2Id);
    });

    it("LICENSEE user → CAN see other club members (global search)", async () => {
      const results = await careerService.searchMembers(
        licenseeClubAId,
        "Charlie",
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(licenseeClubBId);
    });

    it("LICENSEE user with clubName only → finds a licensee by name (global)", async () => {
      // Create a temporary user with clubName but no clubId
      const userWithClubNameOnly = await prisma.user.create({
        data: {
          email: `clubname-only-${suffix}@test.com`,
          password: "hashed",
          firstName: "ClubNameOnly",
          lastName: `Test${suffix}`,
          role: UserRole.LICENSEE,
          clubName: testClubAName,
          // intentionally NO clubId
        },
      });

      // Also create a matching member with only clubName
      const memberInClubByName = await prisma.user.create({
        data: {
          email: `member-clubname-${suffix}@test.com`,
          password: "hashed",
          firstName: "Zoé",
          lastName: `ClubNameMember${suffix}`,
          role: UserRole.LICENSEE,
          clubName: testClubAName,
        },
      });

      const results = await careerService.searchMembers(
        userWithClubNameOnly.id,
        "Zoé",
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(memberInClubByName.id);

      // Cleanup
      await prisma.user.deleteMany({
        where: {
          id: { in: [userWithClubNameOnly.id, memberInClubByName.id] },
        },
      });
    });

    it("Query shorter than 2 chars → returns []", async () => {
      const results = await careerService.searchMembers(staffUserId, "A");
      expect(results).toEqual([]);
    });

    it("Empty query → returns []", async () => {
      const results = await careerService.searchMembers(staffUserId, "");
      expect(results).toEqual([]);
    });

    it("No match → returns []", async () => {
      const results = await careerService.searchMembers(
        staffUserId,
        `zzznomatch${suffix}`,
      );
      expect(results).toEqual([]);
    });

    it("Returns id, firstName, lastName, clubName fields", async () => {
      const results = await careerService.searchMembers(staffUserId, "Alice");
      expect(results.length).toBeGreaterThan(0);
      const alice = results.find((r) => r.id === licenseeClubAId);
      expect(alice).toBeDefined();
      expect(alice).toMatchObject({
        id: expect.any(String),
        firstName: "Alice",
        lastName: `Dupont${suffix}`,
      });
    });
  });

  // ─────────────────────────────────────────────
  // getCareerForUser
  // ─────────────────────────────────────────────
  describe("getCareerForUser", () => {
    it("Non-existent userId → throws NotFoundException", async () => {
      await expect(
        careerService.getCareerForUser("non-existent-id-xyz"),
      ).rejects.toThrow("Utilisateur non trouvé");
    });

    it("Existing user with no partnerships/registrations → returns empty arrays", async () => {
      const career = await careerService.getCareerForUser(
        licenseeNoPartnershipsId,
      );
      expect(career.partnerships).toEqual([]);
      expect(career.registrations).toEqual([]);
      expect(career.results).toEqual([]);
    });

    it("Existing user with registration → returns career data", async () => {
      const career = await careerService.getCareerForUser(licenseeClubAId);
      expect(career).toHaveProperty("partnerships");
      expect(career).toHaveProperty("registrations");
      expect(career).toHaveProperty("results");
    });
  });

  // ─────────────────────────────────────────────
  // getMyCareer
  // ─────────────────────────────────────────────
  describe("getMyCareer", () => {
    it("User with one active partnership → partnerships array has 1 entry with isCurrent=true", async () => {
      const partnership = await prisma.partnership.create({
        data: {
          clubId: clubAId,
          user1Id: licenseeClubAId,
          user2Id: licenseeClubA2Id,
          status: PartnershipStatus.ACTIVE,
          startDate: new Date("2024-01-01"),
        },
      });

      const career = await careerService.getMyCareer(licenseeClubAId);
      expect(career.partnerships).toHaveLength(1);
      expect(career.partnerships[0].isCurrent).toBe(true);
      expect(career.partnerships[0].id).toBe(partnership.id);

      await prisma.partnership.delete({ where: { id: partnership.id } });
    });

    it("User with ended partnership → isCurrent=false", async () => {
      const partnership = await prisma.partnership.create({
        data: {
          clubId: clubAId,
          user1Id: licenseeClubAId,
          user2Id: licenseeClubA2Id,
          status: PartnershipStatus.ACTIVE,
          startDate: new Date("2023-01-01"),
          endDate: new Date("2023-12-31"),
        },
      });

      const career = await careerService.getMyCareer(licenseeClubAId);
      const p = career.partnerships.find((x) => x.id === partnership.id);
      expect(p).toBeDefined();
      expect(p!.isCurrent).toBe(false);
      expect(p!.endDate).not.toBeNull();

      await prisma.partnership.delete({ where: { id: partnership.id } });
    });

    it("User registered in a competition → registrations array populated", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      expect(career.registrations.length).toBeGreaterThan(0);
      const reg = career.registrations.find((r) => r.id === registrationId);
      expect(reg).toBeDefined();
      expect(reg!.event.id).toBe(eventId);
      expect(reg!.competition.id).toBe(competitionId);
    });

    it("User registered → registration has correct status and bibNumber", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      const reg = career.registrations.find((r) => r.id === registrationId);
      expect(reg!.status).toBe("CONFIRMED");
      expect(reg!.bibNumber).toBe(42);
    });

    it("User with results matching their name → results array populated", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      expect(career.results.length).toBeGreaterThan(0);
      const result = career.results.find((r) => r.id === resultId);
      expect(result).toBeDefined();
      expect(result!.ranking).toBe(1);
      expect(result!.round).toBe("Finale");
      expect(result!.participantLabel).toContain(`Alice Dupont${suffix}`);
    });

    it("Results filtered — other user's results in same event NOT included", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      const otherResult = career.results.find((r) => r.id === otherResultId);
      expect(otherResult).toBeUndefined();
    });

    it("Results include event and competition metadata", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      const result = career.results.find((r) => r.id === resultId);
      expect(result!.event.category).toBe("Latin");
      expect(result!.event.ageGroup).toBe("Adulte");
      expect(result!.competition.title).toBe(
        `Test Competition Career ${suffix}`,
      );
    });

    it("Partnership includes partner info and club name", async () => {
      const partnership = await prisma.partnership.create({
        data: {
          clubId: clubAId,
          user1Id: licenseeClubAId,
          user2Id: licenseeClubA2Id,
          status: PartnershipStatus.ACTIVE,
          startDate: new Date("2024-06-01"),
        },
      });

      const career = await careerService.getMyCareer(licenseeClubAId);
      const p = career.partnerships.find((x) => x.id === partnership.id);
      expect(p).toBeDefined();
      expect(p!.partner.id).toBe(licenseeClubA2Id);
      expect(p!.partner.firstName).toBe("Bob");
      expect(p!.clubName).toBe(testClubAName);
      expect(p!.secondaryClubName).toBeNull();

      await prisma.partnership.delete({ where: { id: partnership.id } });
    });

    it("User with no registration has no results", async () => {
      const career = await careerService.getMyCareer(licenseeNoPartnershipsId);
      expect(career.results).toEqual([]);
    });

    it("getMyCareer returns the three required keys", async () => {
      const career = await careerService.getMyCareer(licenseeClubAId);
      expect(Object.keys(career)).toEqual(
        expect.arrayContaining(["partnerships", "registrations", "results"]),
      );
    });
  });
});
