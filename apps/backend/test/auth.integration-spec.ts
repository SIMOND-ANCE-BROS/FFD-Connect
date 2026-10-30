import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import { IdentifierThrottlerGuard } from "./../src/common/guards/identifier-throttler.guard";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { TtsService } from "./../src/tts/tts.service";
import { configureTestApp } from "./test-app.factory";

describe("AuthController (integration with real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const suffix = Date.now();

  // Helper: create a test user in DB and generate a signed JWT for it
  const makeUser = async (role = UserRole.LICENSEE) => {
    const email = `user-${Math.random().toString(36).slice(2)}@integ-${suffix}.test`;
    const hashed = await bcrypt.hash("Password123!", 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        firstName: "Test",
        lastName: "User",
        role,
      },
    });
    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { user, token, email, password: "Password123!" };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TtsService)
      .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
      .overrideProvider(NotificationsService)
      .useValue({
        createForUser: jest.fn().mockResolvedValue(undefined),
        sendToDevice: jest.fn(),
        sendToTopic: jest.fn(),
      })
      .overrideProvider(SessionCleanupService)
      .useValue({
        onModuleInit: jest.fn(),
        cleanupExpiredSessions: jest.fn(),
        cleanupUserSessions: jest.fn(),
        manualCleanup: jest.fn(),
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
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
  }, 30000);

  afterAll(async () => {
    // Clean refresh tokens before users (FK constraint)
    await prisma.refreshToken
      .deleteMany({
        where: { user: { email: { contains: `@integ-${suffix}.test` } } },
      })
      .catch(() => {});
    await prisma.passwordResetToken
      .deleteMany({
        where: { user: { email: { contains: `@integ-${suffix}.test` } } },
      })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { contains: `@integ-${suffix}.test` } } })
      .catch(() => {});
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------

  describe("POST /auth/login", () => {
    it("returns 201 with access_token, refresh_token and user object on correct credentials", async () => {
      const { email, password } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("access_token");
          expect(typeof res.body.access_token).toBe("string");
          expect(res.body).toHaveProperty("refresh_token");
          expect(typeof res.body.refresh_token).toBe("string");
          expect(res.body).toHaveProperty("user");
          expect(res.body.user).toHaveProperty("id");
          expect(res.body.user).toHaveProperty("email", email);
        });
    });

    it("returns user.role in response", async () => {
      const { email, password } = await makeUser(UserRole.LICENSEE);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body.user).toHaveProperty("role", UserRole.LICENSEE);
        });
    });

    it("returns user.email in response", async () => {
      const { email, password } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body.user.email).toBe(email);
        });
    });

    it("returns 401 on wrong password", async () => {
      const { email } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: email, password: "WrongPassword999!" })
        .expect(401);
    });

    it("returns 401 for non-existent user", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({
          username: `nobody-${suffix}@integ-${suffix}.test`,
          password: "Password123!",
        })
        .expect(401);
    });

    it("returns 400 when password field is missing", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: `someone@integ-${suffix}.test` })
        .expect(400);
    });

    it("returns 400 when username field is missing", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ password: "Password123!" })
        .expect(400);
    });

    it("returns 401 (not 500) on SQL-injection-like input in password", async () => {
      const { email } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/login")
        .send({ username: email, password: "' OR '1'='1" })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/refresh
  // ---------------------------------------------------------------------------

  describe("POST /auth/refresh", () => {
    it("returns 201 with new access_token and refresh_token on valid refresh token", async () => {
      const { email, password } = await makeUser();

      // First login to obtain a real refresh token
      const loginRes = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201);

      const { refresh_token } = loginRes.body as {
        refresh_token: string;
      };

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/refresh")
        .send({ refresh_token })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("access_token");
          expect(res.body).toHaveProperty("refresh_token");
          // Rotation: the new refresh_token must differ from the old one
          expect(res.body.refresh_token).not.toBe(refresh_token);
        });
    });

    it("returns 401 on invalid/random refresh token", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: "totally-invalid-token-abc123xyz" })
        .expect(401);
    });

    it("returns 401 when refresh token has been revoked after logout", async () => {
      const { email, password } = await makeUser();

      const loginRes = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201);

      const { refresh_token } = loginRes.body as { refresh_token: string };

      // Revoke via logout
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/logout")
        .send({ refresh_token })
        .expect(201);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    // #681: rotation must consume the token atomically. Without the
    // conditional update, every concurrent call passed the read check and
    // minted its own valid refresh token.
    it("lets exactly one of several concurrent refreshes with the same token succeed", async () => {
      const { user, email, password } = await makeUser();
      const server = app.getHttpServer() as Parameters<typeof request>[0];

      const loginRes = await request(server)
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201);
      const { refresh_token } = loginRes.body as { refresh_token: string };

      const CONCURRENT = 5;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT }, () =>
          request(server).post("/api/v1/auth/refresh").send({ refresh_token }),
        ),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 401, 401, 401, 401]);

      // Exactly one live refresh token remains: the winner's. The losers
      // minted nothing, and losing the race revoked nothing else.
      const live = await prisma.refreshToken.findMany({
        where: { userId: user.id, revoked: false },
        select: { id: true },
        take: 10,
      });
      expect(live).toHaveLength(1);

      // The winner's session keeps working.
      const winner = results.find((r) => r.status === 201);
      const { refresh_token: next } = winner?.body as { refresh_token: string };
      await request(server)
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: next })
        .expect(201);
    });

    // #687: refresh-token families and reuse detection.
    describe("token families (#687)", () => {
      const login = async (email: string, password: string) => {
        const res = await request(
          app.getHttpServer() as Parameters<typeof request>[0],
        )
          .post("/api/v1/auth/login")
          .send({ username: email, password })
          .expect(201);
        return (res.body as { refresh_token: string }).refresh_token;
      };
      const refresh = (refresh_token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post("/api/v1/auth/refresh")
          .send({ refresh_token });
      const liveTokens = (userId: string) =>
        prisma.refreshToken.findMany({
          where: { userId, revoked: false },
          select: { id: true, familyId: true },
          take: 10,
        });
      /** Pretend the rotation happened long ago, past the grace window. */
      const ageRevocations = (userId: string) =>
        prisma.refreshToken.updateMany({
          where: { userId, revoked: true },
          data: { revokedAt: new Date(Date.now() - 60 * 60 * 1000) },
        });

      it("keeps every rotation of a login in the same family", async () => {
        const { user, email, password } = await makeUser();
        const first = await login(email, password);
        const second = (await refresh(first).expect(201)).body as {
          refresh_token: string;
        };
        await refresh(second.refresh_token).expect(201);

        const all = await prisma.refreshToken.findMany({
          where: { userId: user.id },
          select: { familyId: true },
          take: 10,
        });
        expect(all).toHaveLength(3);
        expect(new Set(all.map((t) => t.familyId)).size).toBe(1);
        expect(all[0].familyId).not.toBeNull();
      });

      it("reusing a rotated token after the grace window revokes its family, not the other devices", async () => {
        const { user, email, password } = await makeUser();
        const phone = await login(email, password);
        const tablet = await login(email, password);

        const rotated = (await refresh(phone).expect(201)).body as {
          refresh_token: string;
        };
        await ageRevocations(user.id);

        // The stale phone token comes back (stolen copy): refused…
        await refresh(phone).expect(401);
        // …and the phone family's live token is gone with it.
        await refresh(rotated.refresh_token).expect(401);
        // The tablet's family is untouched.
        await refresh(tablet).expect(201);

        const live = await liveTokens(user.id);
        expect(live).toHaveLength(1);
      });

      it("a late racer inside the grace window is refused without revoking the family", async () => {
        const { email, password } = await makeUser();
        const token = await login(email, password);

        const winner = (await refresh(token).expect(201)).body as {
          refresh_token: string;
        };
        // Same token again right away: a second tab/app instance.
        await refresh(token).expect(401);

        await refresh(winner.refresh_token).expect(201);
      });

      it("a pre-#687 token without family still refreshes, and its chain is protected", async () => {
        const { user, email, password } = await makeUser();
        const legacy = await login(email, password);
        // Simulate a token issued by the previous image.
        await prisma.refreshToken.updateMany({
          where: { userId: user.id },
          data: { familyId: null },
        });
        const legacyRow = await prisma.refreshToken.findFirstOrThrow({
          where: { userId: user.id },
          select: { id: true },
        });

        const next = (await refresh(legacy).expect(201)).body as {
          refresh_token: string;
        };
        const live = await liveTokens(user.id);
        expect(live).toEqual([
          expect.objectContaining({ familyId: legacyRow.id }),
        ]);

        await ageRevocations(user.id);
        await refresh(legacy).expect(401);
        await refresh(next.refresh_token).expect(401);
        expect(await liveTokens(user.id)).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/logout
  // ---------------------------------------------------------------------------

  describe("POST /auth/logout", () => {
    it("returns 201 success when providing a valid refresh token", async () => {
      const { email, password } = await makeUser();

      const loginRes = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/login")
        .send({ username: email, password })
        .expect(201);

      const { refresh_token } = loginRes.body as { refresh_token: string };

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/logout")
        .send({ refresh_token })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("success", true);
        });
    });

    it("returns 401 when providing an unknown refresh token", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/logout")
        .send({ refresh_token: "non-existent-token-xyz" })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /users/me  (profile endpoint)
  // ---------------------------------------------------------------------------

  describe("GET /users/me", () => {
    it("returns 200 with user profile when authenticated", async () => {
      const { token, email } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("email", email);
          expect(res.body).toHaveProperty("id");
          expect(res.body).not.toHaveProperty("password");
        });
    });

    it("returns 401 without token", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/users/me")
        .expect(401);
    });

    it("returns 401 with a malformed bearer token", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/users/me")
        .set("Authorization", "Bearer not.a.valid.jwt")
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/forgot-password
  // ---------------------------------------------------------------------------

  describe("POST /auth/forgot-password", () => {
    it("returns 201 for an existing email (does not reveal existence)", async () => {
      const { email } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/forgot-password")
        .send({ email })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("success", true);
        });
    });

    it("returns 201 for a non-existent email (same response for security)", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/forgot-password")
        .send({ email: `ghost-${suffix}@integ-${suffix}.test` })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("success", true);
        });
    });

    it("returns 400 when email field is missing", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/forgot-password")
        .send({})
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/change-password
  // ---------------------------------------------------------------------------

  describe("POST /auth/change-password", () => {
    it("returns 201 success when current password is correct and new password is valid", async () => {
      const { token, user } = await makeUser();
      // Use a distinct new password to avoid same-password rejection
      const newPassword = "NewPassword456!";

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "Password123!", newPassword })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("success", true);
        })
        .then(async () => {
          // Restore original password so afterAll cleanup stays clean
          const hashed = await bcrypt.hash("Password123!", 10);
          await prisma.user.update({
            where: { id: user.id },
            data: { password: hashed },
          });
        });
    });

    it("returns 401 when current password is wrong", async () => {
      const { token } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "WrongOld999!",
          newPassword: "NewPassword456!",
        })
        .expect(401);
    });

    it("returns 400 when new password is the same as the current password", async () => {
      const { token } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "Password123!", newPassword: "Password123!" })
        .expect(400);
    });

    it("returns 400 when new password does not meet policy (too short)", async () => {
      const { token } = await makeUser();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "Password123!", newPassword: "short" })
        .expect(400);
    });

    it("returns 401 when called without authentication token", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/auth/change-password")
        .send({
          currentPassword: "Password123!",
          newPassword: "NewPassword456!",
        })
        .expect(401);
    });
  });
});
