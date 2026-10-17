import { INestApplication } from "@nestjs/common";
import {
  emailLookupFor,
  oneAccountPerAddress,
} from "./mocks/email-lookup.mock";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import { IdentifierThrottlerGuard } from "./../src/common/guards/identifier-throttler.guard";
import { HelloAssoService } from "./../src/payment/hello-asso.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("AuthController (e2e)", () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    const mockPrisma = {
      // E-mail lookup (#465): each address designates one account.
      $queryRaw: jest.fn(oneAccountPerAddress("test-uuid")),
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
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
      impersonationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "imp-log-1" }),
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
        .overrideGuard(IdentifierThrottlerGuard)
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
    jwtService = moduleFixture.get<JwtService>(JwtService);
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
      disabledAt: null,
      club: null,
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

  it("/api/v1/auth/login (POST) - accepts the address typed with capitals and spaces (#465)", async () => {
    const password = "password123";
    const mockUser = {
      id: "test-uuid",
      email: "test@example.com",
      password: await bcrypt.hash(password, 10),
      disabledAt: null,
      club: null,
      role: "LICENSEE",
    };
    const findUnique = prismaService.user.findUnique as jest.Mock;
    findUnique.mockClear();
    findUnique.mockResolvedValue(mockUser);

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/login")
      .send({ username: "  Test@Example.COM ", password })
      .expect(201);
    expect(prismaService.$queryRaw).toHaveBeenCalledWith(
      emailLookupFor("test@example.com"),
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "test-uuid" } }),
    );
  });

  it("/api/v1/auth/login (POST) - fails with wrong password", async () => {
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    const mockUser = {
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
      disabledAt: null,
      club: null,
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
      disabledAt: null,
      club: null,
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

  it("/api/v1/auth/login (POST) - refuses a disabled account with 403 after a valid password", async () => {
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Doe",
      role: "LICENSEE",
      disabledAt: new Date(),
      club: null,
      license: null,
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post("/api/v1/auth/login")
      .send({ username: "test@example.com", password })
      .expect(403);
    expect(res.body.message).toBe("Compte désactivé. Contactez la fédération.");
  });

  it("/api/v1/auth/login (POST) - a disabled account with a wrong password stays a plain 401", async () => {
    const hashedPassword = await bcrypt.hash("password123", 10);
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
      id: "test-uuid",
      email: "test@example.com",
      password: hashedPassword,
      role: "LICENSEE",
      disabledAt: new Date(),
      club: null,
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post("/api/v1/auth/login")
      .send({ username: "test@example.com", password: "wrongpassword" })
      .expect(401);
    expect(JSON.stringify(res.body)).not.toContain("désactivé");
  });

  it("rejects a live access token once the account is disabled (JwtStrategy)", async () => {
    const token = jwtService.sign({
      sub: "test-uuid",
      email: "test@example.com",
      role: "LICENSEE",
    });
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
      role: "LICENSEE",
      disabledAt: new Date(),
      club: null,
    });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/impersonate/stop")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("lets a live access token of an active account through (JwtStrategy)", async () => {
    const token = jwtService.sign({
      sub: "test-uuid",
      email: "test@example.com",
      role: "LICENSEE",
    });
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
      role: "LICENSEE",
      disabledAt: null,
      club: null,
    });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/auth/impersonate/stop")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
  });

  describe("support access opened by a STAFF account (#733)", () => {
    const STAFF_ID = "11111111-1111-4111-8111-111111111111";
    const TARGET_ID = "22222222-2222-4222-8222-222222222222";
    const active = { disabledAt: null, club: null, extraRoles: [] };
    let accounts: Record<string, Record<string, unknown>>;

    beforeEach(() => {
      accounts = {
        [STAFF_ID]: { id: STAFF_ID, role: "STAFF", ...active },
        [TARGET_ID]: {
          id: TARGET_ID,
          email: "dancer@example.com",
          firstName: "Dan",
          lastName: "Cer",
          clubId: null,
          clubName: null,
          role: "LICENSEE",
          ...active,
        },
      };
      (prismaService.user.findUnique as jest.Mock).mockImplementation(
        (args: { where: { id: string } }) =>
          Promise.resolve(accounts[args.where.id] ?? null),
      );
    });

    const openSession = async (): Promise<string> => {
      const staffToken = jwtService.sign({
        sub: STAFF_ID,
        email: "staff@example.com",
        role: "STAFF",
      });
      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/impersonate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ targetUserId: TARGET_ID, reason: "Ticket support 42" })
        .expect(201);
      return (res.body as { access_token: string }).access_token;
    };

    const callUnder = (token: string) =>
      request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/impersonate/stop")
        .set("Authorization", `Bearer ${token}`);

    it("opens the session, journals it as STAFF and serves requests under it", async () => {
      const token = await openSession();
      expect(prismaService.impersonationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: STAFF_ID,
          actorRole: "STAFF",
          targetUserId: TARGET_ID,
          reason: "Ticket support 42",
        }),
      });
      await callUnder(token).expect(201);
    });

    it("refuses to open a second session from inside the first one", async () => {
      const token = await openSession();
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/impersonate")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetUserId: STAFF_ID, reason: "chain" })
        .expect(403);
    });

    it("ends the session once the STAFF actor is demoted", async () => {
      const token = await openSession();
      accounts[STAFF_ID].role = "LICENSEE";
      await callUnder(token).expect(401);
    });

    it("ends the session once the STAFF actor is disabled", async () => {
      const token = await openSession();
      accounts[STAFF_ID].disabledAt = new Date();
      await callUnder(token).expect(401);
    });

    it.each(["STAFF", "ADMIN"])(
      "ends the session once the target is promoted to %s",
      async (role) => {
        const token = await openSession();
        accounts[TARGET_ID].extraRoles = [role];
        await callUnder(token).expect(401);
      },
    );
  });
});
