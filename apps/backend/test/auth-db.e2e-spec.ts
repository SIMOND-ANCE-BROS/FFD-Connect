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
  }, 30000);

  afterAll(async () => {
    await prisma?.user
      ?.deleteMany({ where: { email: testEmail } })
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
});
