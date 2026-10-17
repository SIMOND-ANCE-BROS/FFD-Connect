import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { ClubPaymentProviderService } from "./../src/clubs/club-payment-provider.service";
import { ClubsHelloAssoService } from "./../src/clubs/clubs-helloasso.service";
import { IdentifierThrottlerGuard } from "./../src/common/guards/identifier-throttler.guard";
import { NotificationPreferencesService } from "./../src/notifications/notification-preferences.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { HelloAssoService } from "./../src/payment/hello-asso.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * Support access (#733): durable writes that would outlive a 15-minute
 * « se connecter en tant que » session are refused under ANY impersonation
 * token (403, service never reached) and work as before otherwise.
 */
describe("Writes blocked under impersonation (e2e, #733)", () => {
  const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
  const CLUB_ID = "22222222-2222-4222-8222-222222222222";
  const LOG_ID = "33333333-3333-4333-8333-333333333333";
  const active = { disabledAt: null, club: null, extraRoles: [] };
  const accounts: Record<string, Record<string, unknown>> = {
    [ADMIN_ID]: { id: ADMIN_ID, role: "ADMIN", ...active },
    [CLUB_ID]: { id: CLUB_ID, role: "CLUB", ...active },
  };

  let app: INestApplication;
  let jwtService: JwtService;
  const helloAsso = { connectHelloAsso: jest.fn() };
  const paymentProvider = { setMyClubPaymentProvider: jest.fn() };
  const notifications = { registerDeviceToken: jest.fn() };
  const preferences = { setPreference: jest.fn() };

  beforeAll(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn((args: { where: { id: string } }) =>
          Promise.resolve(accounts[args.where.id] ?? null),
        ),
      },
      impersonationLog: {
        findUnique: jest.fn().mockResolvedValue({
          actorId: ADMIN_ID,
          targetUserId: CLUB_ID,
          endedAt: null,
        }),
      },
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
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
        .useValue({ createCheckoutIntent: jest.fn() })
        .overrideProvider(ClubsHelloAssoService)
        .useValue(helloAsso)
        .overrideProvider(ClubPaymentProviderService)
        .useValue(paymentProvider)
        .overrideProvider(NotificationsService)
        .useValue(notifications)
        .overrideProvider(NotificationPreferencesService)
        .useValue(preferences)
        .overrideGuard(IdentifierThrottlerGuard)
        .useValue({ canActivate: () => true }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    helloAsso.connectHelloAsso.mockResolvedValue({ connected: true });
    paymentProvider.setMyClubPaymentProvider.mockResolvedValue({
      paymentProvider: "HELLOASSO",
    });
    notifications.registerDeviceToken.mockResolvedValue(undefined);
    preferences.setPreference.mockResolvedValue({
      type: "NEW_COMPETITION",
      enabled: false,
    });
  });

  const clubToken = () =>
    jwtService.sign({ sub: CLUB_ID, email: "club@example.com", role: "CLUB" });
  const impersonationToken = () =>
    jwtService.sign(
      {
        sub: CLUB_ID,
        email: "club@example.com",
        role: "CLUB",
        impersonatedBy: ADMIN_ID,
        impersonationLogId: LOG_ID,
      },
      { expiresIn: "15m" },
    );

  const routes = [
    {
      name: "PUT /clubs/me/helloasso",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .put("/api/v1/clubs/me/helloasso")
          .set("Authorization", `Bearer ${token}`)
          .send({
            clientId: "client-id",
            clientSecret: "client-secret",
            organizationSlug: "mon-club",
          }),
      service: () => helloAsso.connectHelloAsso,
      ok: 200,
    },
    {
      name: "PUT /clubs/me/payment-provider",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .put("/api/v1/clubs/me/payment-provider")
          .set("Authorization", `Bearer ${token}`)
          .send({ paymentProvider: "HELLOASSO" }),
      service: () => paymentProvider.setMyClubPaymentProvider,
      ok: 200,
    },
    {
      name: "POST /notifications/device-token",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post("/api/v1/notifications/device-token")
          .set("Authorization", `Bearer ${token}`)
          .send({ token: "fcm-token-of-the-admin-phone", platform: "IOS" }),
      service: () => notifications.registerDeviceToken,
      ok: 204,
    },
    {
      name: "PATCH /notifications/preferences",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .patch("/api/v1/notifications/preferences")
          .set("Authorization", `Bearer ${token}`)
          .send({ type: "NEW_COMPETITION", enabled: false }),
      service: () => preferences.setPreference,
      ok: 200,
    },
  ];

  describe.each(routes)("$name", ({ send, service, ok }) => {
    it("is refused (403) under an impersonation token", async () => {
      await send(impersonationToken()).expect(403);
      expect(service()).not.toHaveBeenCalled();
    });

    it("works as before for the account itself", async () => {
      await send(clubToken()).expect(ok);
      expect(service()).toHaveBeenCalledTimes(1);
    });
  });
});
