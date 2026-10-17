/**
 * In-app notice of privacy policy changes (#734) against a real Postgres:
 * the new nullable column (migration replayed by `migrate deploy`), the JWT
 * pipeline and DTO validation.
 */
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PRIVACY_POLICY_VERSION } from "../src/privacy-policy/privacy-policy-version";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

const API = "/api/v1";
const ROUTE = `${API}/users/me/privacy-policy`;

describe("Privacy policy notice (integration, real DB, #734)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  const suffix = `privacy-${Date.now()}`;
  const licenseNumbers: string[] = [];

  beforeAll(async () => {
    const built = await buildHttpApp({ redis: true });
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);
  });

  afterAll(async () => {
    await f.cleanup();
    await prisma.license.deleteMany({
      where: { number: { in: licenseNumbers } },
    });
    await app.close();
  });

  const get = (token: string) =>
    request(app.getHttpServer())
      .get(ROUTE)
      .set("Authorization", `Bearer ${token}`);
  const acknowledge = (token: string, body: object) =>
    request(app.getHttpServer())
      .post(`${ROUTE}/acknowledge`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  it("tells an existing account once, until it acknowledges the current version", async () => {
    // An account from before the feature: column NULL.
    const { user, token } = await f.user();

    const before = await get(token).expect(200);
    expect(before.body).toEqual({
      currentVersion: PRIVACY_POLICY_VERSION,
      seenVersion: null,
      pending: true,
    });

    const ack = await acknowledge(token, {
      version: PRIVACY_POLICY_VERSION,
    }).expect(200);
    expect(ack.body.pending).toBe(false);

    const after = await get(token).expect(200);
    expect(after.body.pending).toBe(false);
    expect(
      (
        await prisma.user.findUnique({
          where: { id: user.id },
          select: { privacyPolicySeenVersion: true },
        })
      )?.privacyPolicySeenVersion,
    ).toBe(PRIVACY_POLICY_VERSION);
  });

  it("refuses a stale version (409) and a malformed one (400)", async () => {
    const { token } = await f.user();

    await acknowledge(token, { version: "2020-01-01" }).expect(409);
    await acknowledge(token, { version: "latest" }).expect(400);
    await acknowledge(token, {}).expect(400);

    expect((await get(token).expect(200)).body.pending).toBe(true);
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get(ROUTE).expect(401);
    await request(app.getHttpServer())
      .post(`${ROUTE}/acknowledge`)
      .send({ version: PRIVACY_POLICY_VERSION })
      .expect(401);
  });

  it("does not notify an account registered under the current policy", async () => {
    const number = `19900101-tst-${Date.now().toString(36).slice(-4)}`;
    licenseNumbers.push(number);
    await prisma.license.create({
      data: {
        number,
        category: "Latin",
        clubName: "Club test",
        validUntil: new Date("2099-08-31"),
      },
    });
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/register`)
      .send({
        email: `pp-${Date.now()}@integ-${suffix}.test`,
        password: "Password123!",
        licenseNumber: number,
        lastName: "Martin",
        firstName: "Léa",
      })
      .expect(201);

    const notice = await get(res.body.access_token as string).expect(200);
    expect(notice.body).toEqual({
      currentVersion: PRIVACY_POLICY_VERSION,
      seenVersion: PRIVACY_POLICY_VERSION,
      pending: false,
    });
  });
});
