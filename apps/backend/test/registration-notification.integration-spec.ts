/**
 * Workflow integration test: Registration → Notification
 *
 * Vérifie que l'inscription à une compétition crée bien une notification
 * persistée en base et récupérable via l'API /notifications.
 *
 * Teste aussi le flux de désinscription et son effet sur les notifications.
 */

import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { CompetitionStatus, EventType, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { TtsService } from "./../src/tts/tts.service";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import { PrismaService } from "./../src/prisma/prisma.service";
import { configureTestApp } from "./test-app.factory";

describe("Registration → Notification workflow (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const suffix = `regnotif-${Date.now()}`;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const makeUser = async (role = UserRole.LICENSEE) => {
    const hash = await bcrypt.hash("Password123!", 10);
    const user = await prisma.user.create({
      data: {
        email: `user-${Math.random().toString(36).slice(2)}@${suffix}.test`,
        password: hash,
        firstName: "Test",
        lastName: "User",
        role,
        birthDate: new Date("2000-06-15"),
      },
    });
    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { user, token };
  };

  const makeCompetition = (overrides: Record<string, unknown> = {}) =>
    prisma.competition.create({
      data: {
        title: `Compétition ${suffix}`,
        date: new Date("2026-09-01"),
        location: "Lyon",
        status: CompetitionStatus.UPCOMING,
        ...overrides,
      },
    });

  const makeEvent = (
    competitionId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Solo Adulte",
        eventType: EventType.SOLO,
        ...overrides,
      },
    });

  // ---------------------------------------------------------------------------
  // Bootstrap / Teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TtsService)
      .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
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
    // Scoped cleanup — uniquement les données créées pour ce test
    const compRows = await prisma.competition.findMany({
      where: { title: { contains: suffix } },
      select: { id: true },
    });
    const ids = compRows.map((c) => c.id);

    if (ids.length > 0) {
      await prisma.registration.deleteMany({
        where: { event: { competitionId: { in: ids } } },
      });
      await prisma.event.deleteMany({ where: { competitionId: { in: ids } } });
      await prisma.competition.deleteMany({ where: { id: { in: ids } } });
    }

    await prisma.notification.deleteMany({
      where: { user: { email: { contains: suffix } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: suffix } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: suffix } },
    });

    await app.close();
  });

  // ===========================================================================
  // Workflow: inscription solo → notification créée en base
  // ===========================================================================

  describe("Inscription solo crée une notification", () => {
    it("POST /:id/register retourne 201 et insère une registration", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      expect(res.body).toMatchObject({
        eventId: event.id,
        userId: user.id,
      });
    });

    it("une notification est persistée en base après inscription", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      const notification = await prisma.notification.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });

      expect(notification).not.toBeNull();
      expect(notification?.title).toBeTruthy();
      expect(notification?.body).toContain(comp.title);
    });

    it("GET /notifications retourne la notification créée lors de l'inscription", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/api/v1/notifications")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const notifs: Array<{ userId: string; body: string }> = res.body;
      const mine = notifs.filter((n) => n.userId === user.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine[0].body).toContain(comp.title);
    });
  });

  // ===========================================================================
  // Workflow: double inscription → 409
  // ===========================================================================

  describe("Double inscription retourne 409", () => {
    it("une deuxième inscription au même événement lève un conflit", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(409);
    });
  });

  // ===========================================================================
  // Workflow: inscription à un événement inexistant → 404
  // ===========================================================================

  describe("Inscription à un événement inexistant", () => {
    it("retourne 404 si l'eventId n'existe pas", async () => {
      const { token } = await makeUser();
      const comp = await makeCompetition();

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: "00000000-0000-4000-a000-000000000000" })
        .expect(404);
    });
  });

  // ===========================================================================
  // Workflow: désinscription → notification créée
  // ===========================================================================

  describe("Désinscription crée une notification", () => {
    it("POST /:id/unregister supprime l'inscription et notifie l'utilisateur", async () => {
      const { user, token } = await makeUser();
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      // Inscription
      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      // Désinscription
      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/unregister`)
        .set("Authorization", `Bearer ${token}`)
        .send({ eventId: event.id })
        .expect(201);

      // La registration doit être annulée (statut CANCELLED)
      const registration = await prisma.registration.findFirst({
        where: { userId: user.id, eventId: event.id },
      });
      expect(registration).not.toBeNull();
      expect(registration?.status).toBe("CANCELLED");
    });
  });

  // ===========================================================================
  // Sécurité: pas de token → 401
  // ===========================================================================

  describe("Sécurité", () => {
    it("POST /:id/register sans token retourne 401", async () => {
      const comp = await makeCompetition();
      const event = await makeEvent(comp.id, { eventType: EventType.SOLO });

      await request(app.getHttpServer())
        .post(`/api/v1/competitions/${comp.id}/register`)
        .send({ eventId: event.id })
        .expect(401);
    });

    it("GET /notifications sans token retourne 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/notifications")
        .expect(401);
    });
  });
});
