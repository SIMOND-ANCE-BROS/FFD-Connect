import { randomUUID } from "crypto";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { TrackStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Blacklisting a track from the moderation queue and from the mobile app
 * (#561) goes through PATCH /tracks/:id { blacklisted }: end to end on a real
 * database, the server enforces the ADMIN role (hiding the action in the app is
 * not enough), audits the change, the track leaves the library, and the
 * store-review account only gets a simulated write.
 */
describe("Track blacklist (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const userIds: string[] = [];
  const trackIds: string[] = [];

  const createUser = async (o: {
    role: UserRole;
    extraRoles?: UserRole[];
    isStoreReview?: boolean;
  }) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Blacklist",
        role: o.role,
        extraRoles: o.extraRoles ?? [],
        isStoreReview: o.isStoreReview ?? false,
      },
      select: { id: true, email: true, role: true },
    });
    userIds.push(u.id);
    return u;
  };

  const createTrack = async () => {
    const row = await prisma.track.create({
      data: {
        title: `Blacklist ${randomUUID().slice(0, 8)}`,
        artist: "Orchestre",
        style: "Rumba",
        filename: `${randomUUID()}.mp3`,
        status: TrackStatus.READY,
      },
      select: { id: true },
    });
    trackIds.push(row.id);
    return row.id;
  };

  const bearer = (u: { id: string; email: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: u.id, email: u.email, role: u.role })}`;

  const blacklisted = async (id: string) =>
    (
      await prisma.track.findUnique({
        where: { id },
        select: { blacklisted: true },
      })
    )?.blacklisted;

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp());
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: trackIds } },
    });
    await prisma.track.deleteMany({ where: { id: { in: trackIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    trackIds.length = 0;
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF])(
    "refuses a %s (403) and leaves the track in the library",
    async (role) => {
      const user = await createUser({ role });
      const trackId = await createTrack();

      await request(app.getHttpServer())
        .patch(`/api/v1/tracks/${trackId}`)
        .set("Authorization", bearer(user))
        .send({ blacklisted: true })
        .expect(403);

      expect(await blacklisted(trackId)).toBe(false);
    },
  );

  it("lets an admin blacklist, audits it, hides the track, and is reversible", async () => {
    const admin = await createUser({ role: UserRole.ADMIN });
    const licensee = await createUser({ role: UserRole.LICENSEE });
    const trackId = await createTrack();
    const server = app.getHttpServer();

    await request(server)
      .patch(`/api/v1/tracks/${trackId}`)
      .set("Authorization", bearer(admin))
      .send({ blacklisted: true })
      .expect(200);

    expect(await blacklisted(trackId)).toBe(true);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: trackId, action: "TRACK_UPDATE" },
      select: { actorId: true, before: true, after: true },
    });
    expect(audit).toEqual({
      actorId: admin.id,
      before: { blacklisted: false },
      after: { blacklisted: true },
    });
    // Out of the library: a non-admin gets the missing-track 404.
    await request(server)
      .get(`/api/v1/tracks/${trackId}`)
      .set("Authorization", bearer(licensee))
      .expect(404);

    // Reversible from the back-office.
    await request(server)
      .patch(`/api/v1/tracks/${trackId}`)
      .set("Authorization", bearer(admin))
      .send({ blacklisted: false })
      .expect(200);
    expect(await blacklisted(trackId)).toBe(false);
  });

  it("only simulates the write for the store-review account", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });
    const trackId = await createTrack();

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tracks/${trackId}`)
      .set("Authorization", bearer(reviewer))
      .send({ blacklisted: true })
      .expect(200);

    expect(res.headers["x-demo-mode"]).toBe("simulated");
    expect(await blacklisted(trackId)).toBe(false);
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: trackId } }),
    ).toBe(0);
  });
});
