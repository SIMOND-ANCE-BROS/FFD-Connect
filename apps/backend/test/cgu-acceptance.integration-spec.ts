/**
 * CGU acceptance per account (#894) against a real Postgres: the new nullable
 * columns (migration replayed by `migrate deploy`), the JWT pipeline,
 * impersonation and DTO validation.
 */
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { CGU_VERSION } from "../src/cgu/cgu-version";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

const API = "/api/v1";
const ROUTE = `${API}/users/me/cgu`;

describe("CGU acceptance per account (integration, real DB, #894)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let f: ReturnType<typeof createFactories>;
  const suffix = `cgu-${Date.now()}`;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildHttpApp({ redis: true });
    app = built.app;
    prisma = built.prisma;
    jwt = built.jwt;
    f = createFactories(prisma, suffix, built.jwt);
  });

  afterAll(async () => {
    await prisma.impersonationLog.deleteMany({
      where: { id: { in: sessionIds } },
    });
    await f.cleanup();
    await app.close();
  });

  const get = (token: string) =>
    request(app.getHttpServer())
      .get(ROUTE)
      .set("Authorization", `Bearer ${token}`);
  const accept = (token: string, body: object) =>
    request(app.getHttpServer())
      .post(`${ROUTE}/accept`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const stored = async (userId: string) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { cguAcceptedVersion: true, cguAcceptedAt: true },
    });

  it("asks an existing account until it accepts, then keeps the first timestamp", async () => {
    const { user, token } = await f.user();

    expect((await get(token).expect(200)).body).toEqual({
      currentVersion: CGU_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      accepted: false,
    });

    const first = await accept(token, { version: CGU_VERSION }).expect(200);
    expect(first.body.accepted).toBe(true);
    const firstRow = await stored(user.id);
    expect(firstRow?.cguAcceptedVersion).toBe(CGU_VERSION);
    expect(firstRow?.cguAcceptedAt).toBeInstanceOf(Date);
    expect(first.body.acceptedAt).toBe(firstRow?.cguAcceptedAt?.toISOString());

    // A replay (offline resync, second device) does not rewrite the proof.
    await accept(token, { version: CGU_VERSION }).expect(200);
    expect((await stored(user.id))?.cguAcceptedAt).toEqual(
      firstRow?.cguAcceptedAt,
    );
    expect((await get(token).expect(200)).body.accepted).toBe(true);

    // Part of the GDPR export (policy §9).
    const exported = await request(app.getHttpServer())
      .get(`${API}/users/me/export`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(exported.body.data.cguAcceptedVersion).toBe(CGU_VERSION);
    expect(exported.body.data.cguAcceptedAt).toBe(
      firstRow?.cguAcceptedAt?.toISOString(),
    );
  });

  it("is per account: another account on the same device is still asked", async () => {
    const a = await f.user();
    const b = await f.user();

    await accept(a.token, { version: CGU_VERSION }).expect(200);

    expect((await get(a.token).expect(200)).body.accepted).toBe(true);
    expect((await get(b.token).expect(200)).body.accepted).toBe(false);
  });

  it("refuses a stale version (409) and a malformed one (400)", async () => {
    const { user, token } = await f.user();

    await accept(token, { version: "1" }).expect(409);
    await accept(token, { version: "latest" }).expect(400);
    await accept(token, {}).expect(400);

    expect((await stored(user.id))?.cguAcceptedVersion).toBeNull();
  });

  it("does not let a support session accept on the user's behalf", async () => {
    const admin = await f.user(UserRole.ADMIN);
    const target = await f.user();
    const session = await prisma.impersonationLog.create({
      data: {
        actorId: admin.user.id,
        actorRole: UserRole.ADMIN,
        targetUserId: target.user.id,
        targetRole: target.user.role,
      },
      select: { id: true },
    });
    sessionIds.push(session.id);
    const impersonationToken = jwt.sign({
      sub: target.user.id,
      email: target.user.email,
      role: target.user.role,
      impersonatedBy: admin.user.id,
      impersonationLogId: session.id,
    });

    // The session itself is valid: the user's acceptance can be READ.
    await get(impersonationToken).expect(200);

    await accept(impersonationToken, { version: CGU_VERSION }).expect(403);
    expect((await stored(target.user.id))?.cguAcceptedVersion).toBeNull();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get(ROUTE).expect(401);
    await request(app.getHttpServer())
      .post(`${ROUTE}/accept`)
      .send({ version: CGU_VERSION })
      .expect(401);
  });
});
