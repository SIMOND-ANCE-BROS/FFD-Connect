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
import {
  EXEMPLEVILLE_EXPORT,
  buildZip,
  zipDirectory,
} from "../src/competitions/results-import/topturnier/__fixtures__/zip-builder";
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
 * #786: import of a TopTurnier export (zip upload) through the real guards,
 * JwtStrategy, multer and database — same actors as the CSV import.
 * Fixture: anonymised export (invented names and clubs).
 */
describe("TopTurnier results import HTTP (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const suffix = `tti${Date.now()}`;
  const domain = `@${suffix}.test`;
  const archive = zipDirectory(EXEMPLEVILLE_EXPORT, "Exempleville/");

  let competitionId: string;
  let eventId: string;
  let organiserClubId: string;
  let otherClubId: string;

  const tokenFor = async (
    role: UserRole,
    data: { clubId?: string } = {},
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
    const session = impersonatedBy
      ? await prisma.impersonationLog.create({
          data: {
            actorId: impersonatedBy,
            actorRole: UserRole.ADMIN,
            targetUserId: user.id,
            targetRole: user.role,
          },
          select: { id: true },
        })
      : null;
    return jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(impersonatedBy && { impersonatedBy }),
      ...(session && { impersonationLogId: session.id }),
    });
  };

  const uploadAs = (token: string, query = "?dryRun=true", body = archive) =>
    request(app.getHttpServer())
      .post(
        `/api/v1/competitions/${competitionId}/results/import/topturnier${query}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .attach("file", body, {
        filename: "export.zip",
        contentType: "application/zip",
      });

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

    const [organiser, other] = await Promise.all(
      ["Organisateur", "Autre"].map((name) =>
        prisma.club.create({ data: { name: `Club ${name} ${suffix}` } }),
      ),
    );
    organiserClubId = organiser.id;
    otherClubId = other.id;
    const competition = await prisma.competition.create({
      data: {
        title: `TopTurnier ${suffix}`,
        date: new Date("2026-02-01"),
        location: "Exempleville",
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
        level: "Avancé",
        eventKind: "CLASSIFICATRICE",
      },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: competitionId },
    });
    await prisma.result.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { competitionId } });
    await prisma.competition.deleteMany({ where: { id: competitionId } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: domain } },
      select: { id: true },
      take: 100,
    });
    await prisma.impersonationLog.deleteMany({
      where: { targetUserId: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.club.deleteMany({
      where: { id: { in: [organiserClubId, otherClubId] } },
    });
    await app.close();
  });

  it("401 without a token", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/competitions/${competitionId}/results/import/topturnier`)
      .attach("file", archive, "export.zip")
      .expect(401);
  });

  it("403 for a licensee", async () => {
    const token = await tokenFor(UserRole.LICENSEE);
    await uploadAs(token).expect(403);
    await uploadAs(token, "").expect(403);
  });

  it("403 for another club's account", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: otherClubId });
    await uploadAs(token).expect(403);
    await uploadAs(token, "").expect(403);
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);
  });

  it("403 for an impersonated session of the organiser", async () => {
    const adminToken = await tokenFor(UserRole.ADMIN);
    const adminId = jwt.decode<{ sub: string }>(adminToken).sub;
    const token = await tokenFor(
      UserRole.CLUB,
      { clubId: organiserClubId },
      adminId,
    );
    await uploadAs(token, "").expect(403);
  });

  it("the organiser previews the mapping, then imports its export", async () => {
    const token = await tokenFor(UserRole.CLUB, { clubId: organiserClubId });

    const preview = await uploadAs(token).expect(200);
    expect(preview.body).toMatchObject({
      dryRun: true,
      created: 3,
      linked: null,
      unlinked: null,
    });
    const matched = preview.body.events.filter(
      (e: { status: string }) => e.status === "MATCHED",
    );
    expect(matched).toEqual([
      {
        folder: "3-nat_adultsavancelat",
        label: "Nat, Adults Avancé Latin",
        status: "MATCHED",
        eventId,
        eventName: "Latines Adulte Avancé",
        exact: true,
        rows: 3,
        message: null,
      },
    ]);
    expect(preview.body.events).toHaveLength(7);
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);

    await uploadAs(token, "").expect(200);
    const rows = await prisma.result.findMany({
      where: { eventId },
      select: { ranking: true, round: true },
      orderBy: { ranking: "asc" },
      take: 10,
    });
    expect(rows).toEqual([
      { ranking: 1, round: "Classement final" },
      { ranking: 2, round: "Classement final" },
      { ranking: 3, round: "Classement final" },
    ]);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: competitionId, action: "COMPETITION_RESULTS_IMPORT" },
      select: { after: true },
    });
    expect(audit?.after).toMatchObject({
      source: "TOPTURNIER_UPLOAD",
      actorRole: "CLUB",
      matchedEvents: 1,
    });

    // Re-importing the same export changes nothing.
    const again = await uploadAs(token, "").expect(200);
    expect(again.body).toMatchObject({ created: 0, unchanged: 3 });
  });

  it("STAFF gets the full counts", async () => {
    const token = await tokenFor(UserRole.STAFF);
    const res = await uploadAs(token).expect(200);
    expect(typeof res.body.unlinked).toBe("number");
  });

  it("400 without an archive, on an unsafe archive or an invalid flag", async () => {
    const token = await tokenFor(UserRole.STAFF);
    await request(app.getHttpServer())
      .post(`/api/v1/competitions/${competitionId}/results/import/topturnier`)
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    const traversal = await uploadAs(
      token,
      "",
      buildZip([{ name: "../../index.htm", content: "x" }]),
    ).expect(400);
    expect(traversal.body.message).toBe("Chemin interdit dans l'archive");
    const link = await uploadAs(
      token,
      "",
      buildZip([{ name: "index.htm", content: "/etc", unixMode: 0o120777 }]),
    ).expect(400);
    expect(link.body.message).toBe("Lien symbolique refusé dans l'archive");
    await uploadAs(token, "?dryRun=yes").expect(400);
  });

  it("413 for an archive over 10 MB", async () => {
    const token = await tokenFor(UserRole.STAFF);
    await uploadAs(token, "", Buffer.alloc(10 * 1024 * 1024 + 1, 1)).expect(
      413,
    );
  });
});
