import { INestApplication } from "@nestjs/common";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import { HelloAssoService } from "./../src/payment/hello-asso.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("AuthController (e2e)", () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn() },
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest
          .fn()
          .mockImplementation(
            (args: {
              data: { token: string; userId: string; expiresAt: Date };
            }) =>
              Promise.resolve({
                token: args.data.token,
                userId: args.data.userId,
                expiresAt: args.data.expiresAt,
                id: "mock-token-id",
              }),
          ),
      },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(mockPrisma)
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
        })
        .overrideProvider(HelloAssoService)
        .useValue({
          createCheckoutIntent: jest.fn().mockResolvedValue({
            id: "mock-intent",
            redirectUrl: "https://mock.helloasso.com",
          }),
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
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/auth/login (POST) - successfully logins", async () => {
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    const mockUser = {
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Doe",
      role: "LICENSEE",
      // Mocking nested include
      license: { number: "12345" },
    };

    (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: "test@example.com", password })
      .expect(201) // NestJS default for POST
      .expect((res) => {
        expect(res.body).toHaveProperty("access_token");
        expect(res.body.user).toHaveProperty("email", "test@example.com");
        expect(res.body.user).toHaveProperty("licenseNumber", "12345");
      });
  });

  it("/api/v1/auth/login (POST) - fails with wrong password", async () => {
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    const mockUser = {
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
    };

    (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: "test@example.com", password: "wrongpassword" })
      .expect(401);
  });

  it("/api/v1/auth/login (POST) - fails with non-existent user", async () => {
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: "nonexistent@example.com", password: "password123" })
      .expect(401);
  });

  it("/api/v1/auth/login (POST) - fails with SQL injection attempt in username", async () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({
        username: "admin' OR '1'='1",
        password: "password123",
      })
      .expect(400);
  });

  it("/api/v1/auth/login (POST) - fails with missing credentials", async () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({})
      .expect(400);
  });

  it("/api/v1/auth/login (POST) - handles user without license", async () => {
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    const mockUser = {
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Doe",
      role: "LICENSEE",
      license: null,
    };

    (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: "test@example.com", password })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty("access_token");
        expect(res.body.user).toHaveProperty("email", "test@example.com");
        expect(res.body.user.licenseNumber).toBeUndefined();
      });
  });
});
