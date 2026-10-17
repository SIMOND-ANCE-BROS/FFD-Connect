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
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
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

  describe("support access is ADMIN-only (#733)", () => {
    const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
    const STAFF_ID = "44444444-4444-4444-8444-444444444444";
    const TARGET_ID = "22222222-2222-4222-8222-222222222222";
    const LOG_ID = "33333333-3333-4333-8333-333333333333";
    const active = { disabledAt: null, club: null, extraRoles: [] };
    let accounts: Record<string, Record<string, unknown>>;
    let journal: Partial<
      Record<
        string,
        { actorId: string; targetUserId: string; endedAt: Date | null }
      >
    >;

    beforeEach(() => {
      accounts = {
        [ADMIN_ID]: { id: ADMIN_ID, role: "ADMIN", ...active },
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
      journal = {};
      (prismaService.user.findUnique as jest.Mock).mockImplementation(
        (args: { where: { id: string } }) =>
          Promise.resolve(accounts[args.where.id] ?? null),
      );
      const log = prismaService.impersonationLog as unknown as Record<
        string,
        jest.Mock
      >;
      log.create
        .mockReset()
        .mockImplementation(
          (args: { data: { actorId: string; targetUserId: string } }) => {
            journal[LOG_ID] = {
              actorId: args.data.actorId,
              targetUserId: args.data.targetUserId,
              endedAt: null,
            };
            return Promise.resolve({ id: LOG_ID });
          },
        );
      log.findUnique
        .mockReset()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(journal[args.where.id] ?? null),
        );
      log.updateMany
        .mockReset()
        .mockImplementation(
          (args: { where: { id: string; actorId: string } }) => {
            const row = journal[args.where.id];
            if (!row || row.endedAt || row.actorId !== args.where.actorId) {
              return Promise.resolve({ count: 0 });
            }
            row.endedAt = new Date();
            return Promise.resolve({ count: 1 });
          },
        );
    });

    const server = () => app.getHttpServer() as Parameters<typeof request>[0];
    const tokenOf = (id: string, role: string) =>
      jwtService.sign({ sub: id, email: `${id}@example.com`, role });
    const open = (token: string) =>
      request(server())
        .post("/api/v1/auth/impersonate")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetUserId: TARGET_ID, reason: "Ticket support 42" });
    const stop = (token: string) =>
      request(server())
        .post("/api/v1/auth/impersonate/stop")
        .set("Authorization", `Bearer ${token}`);

    it("lets an ADMIN open a session whose token names its journal row", async () => {
      const res = await open(tokenOf(ADMIN_ID, "ADMIN")).expect(201);
      const token = (res.body as { access_token: string }).access_token;
      expect(jwtService.decode(token)).toMatchObject({
        sub: TARGET_ID,
        impersonatedBy: ADMIN_ID,
        impersonationLogId: LOG_ID,
      });
      expect(prismaService.impersonationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ADMIN_ID,
          actorRole: "ADMIN",
          targetUserId: TARGET_ID,
        }),
        select: { id: true },
      });
    });

    it("refuses a STAFF account (403) without journalling anything", async () => {
      await open(tokenOf(STAFF_ID, "STAFF")).expect(403);
      expect(prismaService.impersonationLog.create).not.toHaveBeenCalled();
    });

    it("refuses to open a second session from inside the first one", async () => {
      const res = await open(tokenOf(ADMIN_ID, "ADMIN")).expect(201);
      const token = (res.body as { access_token: string }).access_token;
      await request(server())
        .post("/api/v1/auth/impersonate")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetUserId: STAFF_ID })
        .expect(403);
    });

    it("stops exactly its own session, then the token is dead", async () => {
      const res = await open(tokenOf(ADMIN_ID, "ADMIN")).expect(201);
      const token = (res.body as { access_token: string }).access_token;
      await stop(token).expect(201);
      expect(prismaService.impersonationLog.updateMany).toHaveBeenCalledWith({
        where: { id: LOG_ID, actorId: ADMIN_ID, endedAt: null },
        data: { endedAt: expect.any(Date) },
      });
      expect(journal[LOG_ID]?.endedAt).toBeInstanceOf(Date);
      await stop(token).expect(401);
    });

    it("ends the session once the ADMIN is demoted to STAFF", async () => {
      const res = await open(tokenOf(ADMIN_ID, "ADMIN")).expect(201);
      const token = (res.body as { access_token: string }).access_token;
      accounts[ADMIN_ID].role = "STAFF";
      await stop(token).expect(401);
    });

    it("refuses a hand-made impersonation token naming no journal row", async () => {
      const token = jwtService.sign({
        sub: TARGET_ID,
        email: "dancer@example.com",
        role: "LICENSEE",
        impersonatedBy: ADMIN_ID,
      });
      await stop(token).expect(401);
    });
  });
});
