import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { SessionCleanupService } from "../src/auth/session-cleanup.service";
import { ThrottlerUserGuard } from "../src/common/guards/throttler-user.guard";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TtsService } from "../src/tts/tts.service";
import { configureTestApp } from "./test-app.factory";

const allow = { canActivate: () => true };
const storage = {
  increment: jest.fn().mockResolvedValue({
    totalHits: 1,
    timeToExpire: 60000,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};

/**
 * #690: who may import / preview / undo the results of a competition, through
 * the real guards and JwtStrategy (account status re-read on each request).
 * The organising club is resolved server-side from the competition id only.
 */
describe("Results import HTTP access (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const suffix = `rih${Date.now()}`;
  const domain = `@${suffix}.test`;
  const csvOf = (eventId: string) =>
    `epreuve;tour;classement;couple;dossard;licences\n${eventId};Finale;1;Alpha / Bravo;12;\n`;

  let competitionId: string;
  let eventId: string;
  let otherEventId: string;
  let organiserClubId: string;
  let otherClubId: string;
  let disabledClubId: string;

  const tokenFor = async (
    role: UserRole,
    data: { clubId?: string; extraRoles?: UserRole[] } = {},
    impersonatedBy?: string,
  ) => {
    const user = await prisma.user.create({
      data: {
        email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}${domain}`,
        password: "x",
        firstName: "Test",
        lastName: suffix,
        role,
        ...data,
      },
    });
    return jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(impersonatedBy && { impersonatedBy }),
    });
  };

  const importAs = (token: string, query = "?dryRun=true", event = eventId) =>
    request(app.getHttpServer())
      .post(`/api/v1/competitions/${competitionId}/results/import${query}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csv: csvOf(event) });

  const deleteAs = (token: string, event = eventId) =>
    request(app.getHttpServer())
      .delete(`/api/v1/competitions/${competitionId}/results?eventId=${event}`)
      .set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TtsService)
      .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
      .overrideProvider(NotificationsService)
      .useValue({
        createForUser: jest.fn().mockResolvedValue(undefined),
        createManyForUsers: jest.fn().mockResolvedValue({ count: 0 }),
        sendToUser: jest
          .fn()
          .mockResolvedValue({ sent: 0, failed: 0, pruned: 0 }),
        sendToUsers: jest
          .fn()
          .mockResolvedValue({ recipients: 0, sent: 0, failed: 0, pruned: 0 }),
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
      .useValue(allow)
      .overrideGuard(ThrottlerUserGuard)
      .useValue(allow)
      .overrideProvider(ThrottlerStorageService)
      .useValue(storage)
      .overrideProvider(ThrottlerStorage)
      .useValue(storage)
      .compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwt = moduleFixture.get(JwtService);

    const [organiser, other, disabled] = await Promise.all(
      ["Organisateur", "Autre", "Desactive"].map((name, i) =>
        prisma.club.create({
          data: {
            name: `Club ${name} ${suffix}`,
            ...(i === 2 && { disabledAt: new Date() }),
          },
        }),
      ),
    );
    organiserClubId = organiser.id;
    otherClubId = other.id;
    disabledClubId = disabled.id;

    const competition = await prisma.competition.create({
      data: {
        title: `Résultats ${suffix}`,
        date: new Date("2026-09-20"),
        location: "Lyon",
        status: "PAST",
        organizer: organiser.name,
        organizerClubId: organiserClubId,
      },
    });
    competitionId = competition.id;
    const event = await prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
      },
    });
    eventId = event.id;

    // An event of another club's competition.
    const foreign = await prisma.competition.create({
      data: {
        title: `Autre ${suffix}`,
        date: new Date("2026-09-21"),
        location: "Lyon",
        organizer: other.name,
        organizerClubId: otherClubId,
      },
    });
    const foreignEvent = await prisma.event.create({
      data: {
        competitionId: foreign.id,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
      },
    });
    otherEventId = foreignEvent.id;
  });

  afterAll(async () => {
    const competitions = await prisma.competition.findMany({
      where: { title: { contains: suffix } },
      select: { id: true },
      take: 10,
    });
    const ids = competitions.map((c) => c.id);
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.result.deleteMany({
      where: { event: { competitionId: { in: ids } } },
    });
    await prisma.event.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competition.deleteMany({ where: { id: { in: ids } } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.club.deleteMany({
      where: { id: { in: [organiserClubId, otherClubId, disabledClubId] } },
    });
    await app.close();
  });

  it("401 without a token", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/competitions/${competitionId}/results/import`)
      .send({ csv: csvOf(eventId) })
      .expect(401);
  });

  it("403 for a licensee (import, dry run and undo)", async () => {
    const token = await tokenFor(UserRole.LICENSEE);
    await importAs(token).expect(403);
    await importAs(token, "").expect(403);
    await deleteAs(token).expect(403);
  });

  it("403 for another club's account, whatever it sends", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: otherClubId });
    await importAs(token).expect(403);
    await importAs(token, "").expect(403);
    await deleteAs(token).expect(403);
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);
  });

  it("401 for the account of a disabled club", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: disabledClubId });
    await importAs(token).expect(401);
    await deleteAs(token).expect(401);
  });

  it("403 for a licensee whose extra CLUB role belongs to a disabled club", async () => {
    const token = await tokenFor(UserRole.LICENSEE, {
      clubId: disabledClubId,
      extraRoles: [UserRole.CLUB],
    });
    await importAs(token).expect(403);
  });

  it("403 for an impersonated session of the organiser (#545)", async () => {
    const adminToken = await tokenFor(UserRole.ADMIN);
    const adminId = jwt.decode<{ sub: string }>(adminToken).sub;
    const token = await tokenFor(
      UserRole.CLUB,
      { clubId: organiserClubId },
      adminId,
    );
    await importAs(token).expect(403);
    await deleteAs(token).expect(403);
  });

  it("the organiser previews (identity-derived counts withheld), imports and undoes its own event", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: organiserClubId });

    const preview = await importAs(token).expect(200);
    expect(preview.body).toEqual({
      dryRun: true,
      created: 1,
      updated: 0,
      unchanged: 0,
      relinked: null,
      anonymisedKept: null,
      linked: null,
      unlinked: null,
    });
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);

    await importAs(token, "?dryRun=false").expect(200);
    expect(await prisma.result.count({ where: { eventId } })).toBe(1);

    const undo = await deleteAs(token).expect(200);
    expect(undo.body).toEqual({ deleted: 1, anonymisedKept: 0 });
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);
  });

  it("the organiser cannot reach an event of another competition through its own", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: organiserClubId });
    await deleteAs(token, otherEventId).expect(404);
    const res = await importAs(token, "?dryRun=true", otherEventId).expect(400);
    expect(res.body.errors).toEqual([
      { line: 2, message: "épreuve inconnue pour cette compétition" },
    ]);
  });

  it("STAFF keeps access to any competition, with the full counts", async () => {
    const token = await tokenFor(UserRole.STAFF);
    const res = await importAs(token).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, created: 1, unlinked: 1 });
  });

  it("400 on an invalid dryRun flag or a missing eventId", async () => {
    const token = await tokenFor(UserRole.STAFF);
    await importAs(token, "?dryRun=yes").expect(400);
    await request(app.getHttpServer())
      .delete(`/api/v1/competitions/${competitionId}/results`)
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });
});
