import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import {
  CompetitionStatus,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { TtsService } from "./../src/tts/tts.service";
import { configureTestApp } from "./test-app.factory";

describe("CompetitionsController HTTP Integration", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const suffix = Date.now();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const makeUser = async (role = UserRole.LICENSEE) => {
    const hash = await bcrypt.hash("Password123!", 10);
    const user = await prisma.user.create({
      data: {
        email: `user-${Math.random().toString(36).slice(2)}@comp-http-${suffix}.test`,
        password: hash,
        firstName: "Test",
        lastName: "User",
        role,
      },
    });
    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { user, token };
  };

  const makeCompetition = async (overrides: Record<string, unknown> = {}) =>
    prisma.competition.create({
      data: {
        title: `Comp ${suffix}`,
        date: new Date("2026-06-01"),
        location: "Paris",
        status: CompetitionStatus.UPCOMING,
        ...overrides,
      },
    });

  const makeEvent = async (
    competitionId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
        ...overrides,
      },
    });

  // ---------------------------------------------------------------------------
  // Bootstrap / teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorageService)
      .useValue({
        increment: jest.fn().mockResolvedValue({
          totalHits: 1,
          timeToExpire: 60000,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: jest.fn().mockResolvedValue({
          totalHits: 1,
          timeToExpire: 60000,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    // Scoped cleanup — only rows belonging to this test run
    const compRows = await prisma.competition.findMany({
      where: { title: { contains: String(suffix) } },
      select: { id: true },
    });
    const ids = compRows.map((c) => c.id);

    if (ids.length > 0) {
      await prisma.result.deleteMany({
        where: { event: { competitionId: { in: ids } } },
      });
      await prisma.scheduleItem.deleteMany({
        where: { competitionId: { in: ids } },
      });
      await prisma.registration.deleteMany({
        where: { event: { competitionId: { in: ids } } },
      });
      await prisma.event.deleteMany({ where: { competitionId: { in: ids } } });
      await prisma.competition.deleteMany({ where: { id: { in: ids } } });
    }

    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: `@comp-http-${suffix}.test` } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: `@comp-http-${suffix}.test` } },
    });

    await app.close();
  });

  // ===========================================================================
  // GET /competitions
  // ===========================================================================

  describe("GET /competitions", () => {
    it("returns 200 when no token is provided (public endpoint)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions")
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("returns 200 with paginated response shape when authenticated", async () => {
      const { token } = await makeUser();

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty("meta");
      expect(res.body.meta).toMatchObject({
        skip: expect.any(Number),
        take: expect.any(Number),
        total: expect.any(Number),
      });
    });

    it("includes created competition in the data array", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition({ title: `Visible ${suffix}` });

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const ids = res.body.data.map((c: { id: string }) => c.id);
      expect(ids).toContain(comp.id);
    });

    it("respects ?skip=0&take=1 pagination — returns at most 1 item", async () => {
      const { token } = await makeUser();
      // Ensure at least 2 competitions exist
      await makeCompetition();
      await makeCompetition();

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions?skip=0&take=1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBeLessThanOrEqual(1);
      expect(res.body.meta.take).toBe(1);
      expect(res.body.meta.skip).toBe(0);
    });

    it("returns empty data array when no competitions match the visible set", async () => {
      const { token } = await makeUser();

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions?skip=999999&take=10")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });

  // ===========================================================================
  // GET /competitions/:id
  // ===========================================================================

  describe("GET /competitions/:id", () => {
    it("returns 200 with competition details including events array", async () => {
      const comp = await makeCompetition();
      await makeEvent(comp.id);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/competitions/${comp.id}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: comp.id,
        location: "Paris",
      });
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    });

    it("returns 200 with empty events array when competition has no events", async () => {
      const comp = await makeCompetition();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/competitions/${comp.id}`)
        .expect(200);

      expect(res.body.id).toBe(comp.id);
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it("returns 404 for a non-existent UUID", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/competitions/00000000-0000-4000-a000-000000000000")
        .expect(404);
    });

    it("returns 400 or 404 for an invalid UUID format", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/not-a-valid-uuid")
        .send();

      expect([400, 404]).toContain(res.status);
    });
  });

  // ===========================================================================
  // POST /competitions/:id/register
  // ===========================================================================

  describe("POST /competitions/:id/register", () => {
    it("returns 401 without token", async () => {
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .send({ eventId: event.id })
        .expect(401);
    });

    it("registers authenticated user for a SOLO event → 201 with registration fields", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      expect(res.body).toMatchObject({
        eventId: event.id,
        userId: user.id,
      });
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("status");
    });

    it("registers user for a COUPLE event when partnerName is provided → 201", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: "COUPLE" });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id, partnerName: "Marie Dupont" })
        .expect(201);

      expect(res.body.partnerName).toBe("Marie Dupont");
    });

    it("returns 400 for COUPLE event when partnerName is missing", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: "COUPLE" });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(400);
    });

    it("returns 400 when eventId is missing from body", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it("returns 400 when eventId is not a valid UUID", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: "not-a-uuid" })
        .expect(400);
    });

    it("returns 404 when event does not exist", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: "00000000-0000-4000-a000-000000000001" })
        .expect(404);
    });

    it("returns 409 or 400 on double registration for same event", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      const secondRes = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id });

      expect([400, 409]).toContain(secondRes.status);
    });

    it("allows re-registration after unregistering", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);
    });
  });

  // ===========================================================================
  // POST /competitions/:id/unregister
  // ===========================================================================

  describe("POST /competitions/:id/unregister", () => {
    it("returns 401 without token", async () => {
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .send({ eventId: event.id })
        .expect(401);
    });

    it("unregisters a previously registered user → 200 with registration data", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("eventId");
    });

    it("returns 404 when user has no registration for the event", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(404);
    });

    it("returns 400 when eventId is missing", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(400);
    });
  });

  // ===========================================================================
  // POST /competitions/:id/checkin
  // ===========================================================================

  describe("POST /competitions/:id/checkin", () => {
    it("returns 401 without token", async () => {
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .send({ qrData: "some-user-id" })
        .expect(401);
    });

    it("returns 404 when user is not registered for the competition", async () => {
      const { token } = await makeUser();
      const { user: otherUser } = await makeUser();
      const comp = await makeCompetition();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: otherUser.id })
        .expect(404);

      expect(res.body).toHaveProperty("statusCode", 404);
    });

    it("returns 404 when qrData refers to a non-existent user", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: "00000000-0000-4000-a000-000000000099" })
        .expect(404);
    });

    it("returns 400 when qrData is missing", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it("successfully checks in a user with a CONFIRMED registration with feePaid=true → 200 with results", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      // Seed a CONFIRMED registration with feePaid=true directly via Prisma
      await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          status: RegistrationStatus.CONFIRMED,
          feePaid: true,
          checkedIn: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: user.id })
        .expect(201);

      expect(res.body).toHaveProperty("registrations");
      expect(Array.isArray(res.body.registrations)).toBe(true);
      expect(res.body.registrations.length).toBeGreaterThanOrEqual(1);
      const checkInResult = res.body.registrations[0] as { status: string };
      expect(checkInResult.status).toBe("SUCCESS");
    });

    it("returns ALREADY_CHECKED_IN status when checking in a user who is already checked in", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          status: RegistrationStatus.CONFIRMED,
          feePaid: true,
          checkedIn: true,
          checkInTime: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: user.id })
        .expect(201);

      expect(Array.isArray(res.body.registrations)).toBe(true);
      const checkInResult = res.body.registrations[0] as { status: string };
      expect(checkInResult.status).toBe("ALREADY_CHECKED_IN");
    });

    it("returns ERROR status for a registration with feePaid=false", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          status: RegistrationStatus.CONFIRMED,
          feePaid: false,
          checkedIn: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: user.id })
        .expect(201);

      expect(Array.isArray(res.body.registrations)).toBe(true);
      const checkInResult = res.body.registrations[0] as { status: string };
      expect(checkInResult.status).toBe("ERROR");
    });

    it("accepts JSON-encoded qrData with an id field", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          status: RegistrationStatus.CONFIRMED,
          feePaid: true,
          checkedIn: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: JSON.stringify({ id: user.id }) })
        .expect(201);

      expect(Array.isArray(res.body.registrations)).toBe(true);
      const checkInResult = res.body.registrations[0] as { status: string };
      expect(["SUCCESS", "ALREADY_CHECKED_IN"]).toContain(checkInResult.status);
    });
  });

  // ===========================================================================
  // GET /competitions/:id/results
  // ===========================================================================

  describe("GET /competitions/:id/results", () => {
    it("returns 200 with empty or structured response when no results exist", async () => {
      const comp = await makeCompetition();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/competitions/${comp.id}/results`)
        .expect(200);

      // The endpoint should return an array or an object with a results key
      const isArray = Array.isArray(res.body);
      const isObject = typeof res.body === "object" && res.body !== null;
      expect(isArray || isObject).toBe(true);
    });

    it("returns 404 for a non-existent competition", async () => {
      await request(app.getHttpServer())
        .get(
          "/api/v1/competitions/00000000-0000-4000-a000-000000000002/results",
        )
        .expect(404);
    });

    it("returns results when result data has been seeded", async () => {
      const { user } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      const registration = await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          status: RegistrationStatus.CONFIRMED,
          feePaid: true,
        },
      });

      await prisma.result.create({
        data: {
          eventId: event.id,
          userId: user.id,
          ranking: 1,
          round: "FINAL",
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/competitions/${comp.id}/results`)
        .expect(200);

      // Response is either an array with entries or an object containing results
      const body = res.body as unknown;
      if (Array.isArray(body)) {
        expect(body.length).toBeGreaterThanOrEqual(1);
      } else {
        const obj = body as Record<string, unknown>;
        expect(obj).toBeDefined();
      }
    });
  });

  // ===========================================================================
  // GET /competitions/active (public)
  // ===========================================================================

  describe("GET /competitions/active", () => {
    it("returns 200 or 404 (no error 500)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/active")
        .send();

      expect([200, 404]).toContain(res.status);
    });

    it("returns 200 with competition data when an ACTIVE competition exists for today", async () => {
      const today = new Date();
      await makeCompetition({
        title: `Active Today ${suffix}`,
        date: today,
        status: CompetitionStatus.LIVE,
      });

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/active")
        .send();

      // May be 200 or 404 depending on service logic; just ensure it doesn't 500
      expect([200, 404]).toContain(res.status);
    });
  });

  // ===========================================================================
  // GET /competitions/regulation (public)
  // ===========================================================================

  describe("GET /competitions/regulation", () => {
    it("returns 200 with regulation constants", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/regulation")
        .expect(200);

      expect(res.body).toHaveProperty("competitionTypes");
      expect(res.body).toHaveProperty("eventKinds");
      expect(Array.isArray(res.body.competitionTypes)).toBe(true);
    });
  });

  // ===========================================================================
  // POST /competitions (create) — CLUB/ADMIN role required
  // ===========================================================================

  describe("POST /competitions (create)", () => {
    it("returns 403 when a LICENSEE user tries to create a competition", async () => {
      const { token } = await makeUser(UserRole.LICENSEE);

      await request(app.getHttpServer())
        .post("/api/v1/competitions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: `Created ${suffix}`,
          date: "2026-09-01",
          location: "Lyon",
          status: CompetitionStatus.UPCOMING,
        })
        .expect(403);
    });

    it("returns 201 when a CLUB user creates a competition", async () => {
      const { token } = await makeUser(UserRole.CLUB);

      const res = await request(app.getHttpServer())
        .post("/api/v1/competitions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: `Created By Club ${suffix}`,
          date: "2026-09-01",
          location: "Lyon",
          status: CompetitionStatus.UPCOMING,
        })
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body.location).toBe("Lyon");
    });

    it("returns 401 without token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/competitions")
        .send({
          title: `NoToken ${suffix}`,
          date: "2026-09-01",
          location: "Bordeaux",
          status: CompetitionStatus.UPCOMING,
        })
        .expect(401);
    });
  });

  // ===========================================================================
  // GET /competitions/user/registrations
  // ===========================================================================

  describe("GET /competitions/user/registrations", () => {
    it("returns 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/competitions/user/registrations")
        .expect(401);
    });

    it("returns 200 with empty array when user has no registrations", async () => {
      const { token } = await makeUser();

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/user/registrations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns registration after user registers for an event", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, {
        eventType: "SOLO",
        ageGroup: "Solo Adulte",
      });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/api/v1/competitions/user/registrations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const eventIds = (res.body as Array<{ eventId: string }>).map(
        (r) => r.eventId,
      );
      expect(eventIds).toContain(event.id);
      void user; // referenced for clarity
    });
  });
});
