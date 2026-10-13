import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { TtsService } from "./../src/tts/tts.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * E2E avec vraie base de données : vérifie le parcours login de bout en bout
 * (création utilisateur en DB, POST /auth/login, réponse avec token).
 * S'exécute en CI (Postgres + migrations) et en local si une DB de test est disponible.
 * TtsService est mocké pour éviter les erreurs d'init (dynamic import) en environnement Jest.
 */
describe("AuthController (e2e with real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = `e2e-db-auth-${Date.now()}@test.com`;
  const plainPassword = "E2ePassword123!";
  // Account stored before addresses were normalised at write time (#465).
  const legacyEmail = `E2E-Legacy-${Date.now()}@Test.com`;
  // Two distinct legacy accounts differing only by case (#465).
  const twinUpper = `E2E-Twin-${Date.now()}@Test.com`;
  const twinLower = twinUpper.toLowerCase();
  const twinPasswords = { upper: "TwinUpper123!", lower: "TwinLower123!" };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TtsService)
        .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(false),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    await prisma.user.create({
      data: {
        email: testEmail,
        password: hashedPassword,
        firstName: "E2E",
        lastName: "User",
        role: UserRole.LICENSEE,
      },
    });
    await prisma.user.create({
      data: {
        email: legacyEmail,
        password: hashedPassword,
        firstName: "E2E",
        lastName: "Legacy",
        role: UserRole.LICENSEE,
      },
    });
    for (const [email, password] of [
      [twinUpper, twinPasswords.upper],
      [twinLower, twinPasswords.lower],
    ] as const) {
      await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 10),
          firstName: "E2E",
          lastName: "Twin",
          role: UserRole.LICENSEE,
        },
      });
    }
  }, 30000);

  afterAll(async () => {
    await prisma?.user
      ?.deleteMany({
        where: {
          email: { in: [testEmail, legacyEmail, twinUpper, twinLower] },
        },
      })
      .catch(() => {});
    await app?.close();
  }, 10000);

  it("POST /auth/login returns token when user exists in DB", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: testEmail, password: plainPassword })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty("access_token");
        expect(res.body.user).toHaveProperty("email", testEmail);
      });
  });

  it("POST /auth/login accepts another casing, padded, of a normalised address (#465)", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({
        username: `  ${testEmail.toUpperCase()} `,
        password: plainPassword,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.user).toHaveProperty("email", testEmail);
      });
  });

  it("POST /auth/login finds a legacy account stored with capitals (#465)", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: legacyEmail.toLowerCase(), password: plainPassword })
      .expect(201)
      .expect((res) => {
        expect(res.body.user).toHaveProperty("email", legacyEmail);
      });
  });

  it("POST /auth/forgot-password issues a reset token for a legacy mixed-case account (#465)", async () => {
    const legacy = await prisma.user.findUniqueOrThrow({
      where: { email: legacyEmail },
      select: { id: true },
    });
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/forgot-password")
      .send({ email: legacyEmail.toLowerCase() })
      .expect((res) => {
        expect(res.status).toBeLessThan(300);
      });
    await expect(
      prisma.passwordResetToken.count({ where: { userId: legacy.id } }),
    ).resolves.toBeGreaterThan(0);
  });

  it.each(["%@test.com", "_2e-db-auth-%@test.com", "e2e-db-auth-_%"])(
    "a wildcard-bearing address %p never reaches another account, same answers (#465)",
    async (typed) => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const before = await prisma.passwordResetToken.count();

      const login = await request(server)
        .post("/api/v1/auth/login")
        .send({ username: typed, password: plainPassword });
      expect([400, 401]).toContain(login.status);
      expect(login.body).not.toHaveProperty("access_token");

      const forgot = await request(server)
        .post("/api/v1/auth/forgot-password")
        .send({ email: typed });
      const unknown = await request(server)
        .post("/api/v1/auth/forgot-password")
        .send({ email: `nobody-${Date.now()}@test.com` });
      if (forgot.status < 300) {
        // Accepted by the DTO: exactly the unknown-address answer.
        expect(forgot.status).toBe(unknown.status);
        expect(forgot.body).toEqual(unknown.body);
      }
      await expect(prisma.passwordResetToken.count()).resolves.toBe(before);
    },
  );

  describe("two accounts differing only by case (#465)", () => {
    const login = (username: string, password: string) =>
      request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username, password });

    it("each twin logs into its own account with its exact address", async () => {
      const upper = await login(twinUpper, twinPasswords.upper).expect(201);
      expect(upper.body.user).toHaveProperty("email", twinUpper);
      const lower = await login(twinLower, twinPasswords.lower).expect(201);
      expect(lower.body.user).toHaveProperty("email", twinLower);
    });

    it("a twin's password never opens the other account", async () => {
      await login(twinUpper, twinPasswords.lower).expect(401);
      await login(twinLower, twinPasswords.upper).expect(401);
    });

    it("any other casing is refused like an unknown address", async () => {
      const other = twinUpper.toUpperCase();
      await login(other, twinPasswords.upper).expect(401);
      await login(other, twinPasswords.lower).expect(401);
    });

    it("forgot password targets only the twin typed exactly, else nobody", async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const ids = await prisma.user.findMany({
        where: { email: { in: [twinUpper, twinLower] } },
        select: { id: true, email: true },
        take: 2,
      });
      const idOf = (email: string) => ids.find((u) => u.email === email)!.id;
      const count = (userId: string) =>
        prisma.passwordResetToken.count({ where: { userId } });

      const unknown = await request(server)
        .post("/api/v1/auth/forgot-password")
        .send({ email: `nobody-${Date.now()}@test.com` });
      const ambiguous = await request(server)
        .post("/api/v1/auth/forgot-password")
        .send({ email: twinUpper.toUpperCase() });
      expect(ambiguous.status).toBe(unknown.status);
      expect(ambiguous.body).toEqual(unknown.body);
      await expect(count(idOf(twinUpper))).resolves.toBe(0);
      await expect(count(idOf(twinLower))).resolves.toBe(0);

      await request(server)
        .post("/api/v1/auth/forgot-password")
        .send({ email: twinUpper });
      await expect(count(idOf(twinUpper))).resolves.toBe(1);
      await expect(count(idOf(twinLower))).resolves.toBe(0);
    });

    it("registration refuses a new account colliding with the twins", async () => {
      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/register")
        .send({
          email: twinUpper.toUpperCase(),
          password: "Brand-New-Pass1!",
          licenseNumber: "E2E-NOPE-465",
          lastName: "Twin",
          firstName: "E2E",
        });
      expect(res.status).toBe(409);
    });
  });
});
