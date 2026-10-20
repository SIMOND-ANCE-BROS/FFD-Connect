import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { SessionCleanupService } from "../src/auth/session-cleanup.service";
import { ThrottlerUserGuard } from "../src/common/guards/throttler-user.guard";
import { CompetitionTopTurnierUrlImportService } from "../src/competitions/services/competition-topturnier-url-import.service";
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

/** Anonymised list page (invented towns and titles). */
const FIXTURE = readFileSync(
  join(
    __dirname,
    "../src/competitions/results-import/topturnier/__fixtures__/chairperson-index.html",
  ),
);

/**
 * #801 (temporary, with #787): list of the recent competitions of the
 * TopTurnier site through the real guards, JwtStrategy and database. The
 * site itself is never reached: `fetchPage` is mocked.
 */
describe("Admin TopTurnier list of recent competitions (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let urlImport: CompetitionTopTurnierUrlImportService;
  let jwt: JwtService;
  const suffix = `tti801${Date.now()}`;
  const domain = `@${suffix}.test`;
  let clubId: string;
  let competitionId: string;

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
    return {
      id: user.id,
      token: jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        ...(impersonatedBy && { impersonatedBy }),
        ...(session && { impersonationLogId: session.id }),
      }),
    };
  };

  const list = (token: string | null, query = "?year=2026") => {
    const req = request(app.getHttpServer()).get(
      `/api/v1/admin/topturnier/competitions${query}`,
    );
    return token === null ? req : req.set("Authorization", `Bearer ${token}`);
  };
  const status = (token: string) =>
    request(app.getHttpServer())
      .get("/api/v1/admin/topturnier/status")
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
    urlImport = moduleFixture.get(CompetitionTopTurnierUrlImportService);

    const club = await prisma.club.create({
      data: { name: `Club Organisateur ${suffix}` },
    });
    clubId = club.id;
    const competition = await prisma.competition.create({
      data: {
        title: `Trophée ${suffix}`,
        // 2026-10-17 00:00 Paris, the day of the « Exempleville » entry.
        date: new Date("2026-10-16T22:00:00Z"),
        location: "Salle des fêtes",
        city: "Exempleville",
        status: "PAST",
        organizerClubId: clubId,
      },
    });
    competitionId = competition.id;
  });

  afterAll(async () => {
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
    await prisma.club.deleteMany({ where: { id: clubId } });
    await app.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const enable = () => {
    jest.spyOn(urlImport, "isEnabled").mockReturnValue(true);
    jest.spyOn(urlImport, "sleep").mockResolvedValue(undefined);
    return jest
      .spyOn(urlImport, "fetchPage")
      .mockResolvedValue({ status: 200, location: null, body: FIXTURE });
  };

  it("401 without a token", async () => {
    await list(null).expect(401);
  });

  it("403 for a licensee and for a club account, without any request to the site", async () => {
    const fetchPage = enable();
    const licensee = await tokenFor(UserRole.LICENSEE);
    const clubAccount = await tokenFor(UserRole.CLUB, { clubId });
    await list(licensee.token).expect(403);
    await list(clubAccount.token).expect(403);
    await status(licensee.token).expect(403);
    await status(clubAccount.token).expect(403);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("403 for an impersonated session", async () => {
    const fetchPage = enable();
    const admin = await tokenFor(UserRole.ADMIN);
    const target = await tokenFor(UserRole.STAFF, {}, admin.id);
    await list(target.token).expect(403);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("404 while the flag is off (default), status says disabled, no request", async () => {
    const fetchPage = jest.spyOn(urlImport, "fetchPage");
    const staff = await tokenFor(UserRole.STAFF);
    await list(staff.token).expect(404);
    const res = await status(staff.token).expect(200);
    expect(res.body).toEqual({ enabled: false });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("400 for a year out of range or not a number, before any request", async () => {
    const fetchPage = enable();
    const staff = await tokenFor(UserRole.STAFF);
    await list(staff.token, "?year=abc").expect(400);
    await list(staff.token, "?year=1999").expect(400);
    await list(staff.token, "?year=2026&extra=1").expect(400);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("STAFF lists the entries matched against the database", async () => {
    const fetchPage = enable();
    const staff = await tokenFor(UserRole.STAFF);
    const now = new Date();
    const year = Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
      }).format(now),
    );
    expect((await status(staff.token).expect(200)).body).toEqual({
      enabled: true,
    });
    const res = await list(staff.token, `?year=${year}`).expect(200);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.body.years).toEqual([year]);
    const entry = (res.body.items as { exportUrl: string }[]).find((i) =>
      i.exportUrl.endsWith("/20261017_exempleville/index.htm"),
    );
    expect(entry).toEqual({
      date: "2026-10-17",
      title: "Exempleville, 2eme trophée d'automne",
      category: "Ep. à Points, Opens",
      exportUrl:
        "https://chairperson.ddsbagnols.com/resultats/20261017_exempleville/index.htm",
      match: { status: "MATCHED", competitionId, candidates: [] },
      resultsAlreadyImported: false,
    });
  });

  it("ADMIN reads both years in one call (2 pages at most)", async () => {
    const fetchPage = enable();
    const admin = await tokenFor(UserRole.ADMIN);
    await list(admin.token, "").expect(200);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("502 when the site is unreachable", async () => {
    enable().mockRejectedValue(new Error("ECONNRESET"));
    const staff = await tokenFor(UserRole.STAFF);
    await list(staff.token, "").expect(502);
  });
});
