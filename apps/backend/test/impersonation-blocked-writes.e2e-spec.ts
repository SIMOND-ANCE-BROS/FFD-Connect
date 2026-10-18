import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { ClubPaymentProviderService } from "./../src/clubs/club-payment-provider.service";
import { ClubsHelloAssoService } from "./../src/clubs/clubs-helloasso.service";
import { PartnershipService } from "./../src/clubs/partnership.service";
import { CompetitionRegistrationService } from "./../src/competitions/services/competition-registration.service";
import { UsersService } from "./../src/users/users.service";
import { IdentifierThrottlerGuard } from "./../src/common/guards/identifier-throttler.guard";
import { LicenseRenewalService } from "./../src/licenses/license-renewal.service";
import { AppleWalletPassService } from "./../src/licenses/wallet/apple-wallet-pass.service";
import { NotificationPreferencesService } from "./../src/notifications/notification-preferences.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { HelloAssoService } from "./../src/payment/hello-asso.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * Support access (#733): durable writes that would outlive a 15-minute
 * « se connecter en tant que » session are refused under ANY impersonation
 * token (403, service never reached) and work as before otherwise — the
 * licence Wallet pass (#759), the renewal writes (#760) and the lasting
 * writes of #761 included. Every write under impersonation is journalled
 * (#761).
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
  const EVENT_ID = "55555555-5555-4555-8555-555555555555";
  const MEMBER_ID = "66666666-6666-4666-8666-666666666666";
  const helloAsso = {
    connectHelloAsso: jest.fn(),
    setRegistrationMode: jest.fn(),
  };
  const registrations = { unregister: jest.fn(), unregisterMember: jest.fn() };
  const partnerships = { endPartnership: jest.fn() };
  const users = { updateWdsf: jest.fn() };
  const actionLog = { create: jest.fn() };
  const paymentProvider = { setMyClubPaymentProvider: jest.fn() };
  const notifications = { registerDeviceToken: jest.fn() };
  const preferences = { setPreference: jest.fn() };
  const renewal = {
    startRenewalRequest: jest.fn(),
    uploadRenewalDocument: jest.fn(),
    submitRenewalRequest: jest.fn(),
  };
  const walletPass = { issueDownloadToken: jest.fn() };
  const RENEWAL_ID = "44444444-4444-4444-8444-444444444444";
  // PNG signature + padding: passes the certificate type and size checks.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2048),
  ]);

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
          startedAt: new Date(),
          endedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Journal of the writes made under impersonation (#761).
      impersonationActionLog: actionLog,
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
        .overrideProvider(LicenseRenewalService)
        .useValue(renewal)
        .overrideProvider(AppleWalletPassService)
        .useValue(walletPass)
        .overrideProvider(CompetitionRegistrationService)
        .useValue(registrations)
        .overrideProvider(PartnershipService)
        .useValue(partnerships)
        .overrideProvider(UsersService)
        .useValue(users)
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
    renewal.startRenewalRequest.mockResolvedValue({ id: RENEWAL_ID });
    renewal.uploadRenewalDocument.mockResolvedValue({ id: RENEWAL_ID });
    renewal.submitRenewalRequest.mockResolvedValue({ id: RENEWAL_ID });
    walletPass.issueDownloadToken.mockResolvedValue({
      token: "t".repeat(43),
      expiresAt: new Date(Date.now() + 300_000),
    });
    helloAsso.setRegistrationMode.mockResolvedValue({
      registrationMode: "CLUB_ONLY",
    });
    registrations.unregister.mockResolvedValue({ id: "reg-1" });
    registrations.unregisterMember.mockResolvedValue({ success: true });
    partnerships.endPartnership.mockResolvedValue({ id: "p-1" });
    users.updateWdsf.mockResolvedValue({ id: CLUB_ID });
    actionLog.create.mockResolvedValue({ id: "action-1" });
  });

  /** The journal row is written once the response is over (`close`). */
  const journalled = async (calls: number) => {
    for (let i = 0; i < 50 && actionLog.create.mock.calls.length < calls; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return actionLog.create.mock.calls.map(
      (call: [{ data: Record<string, unknown> }]) => call[0].data,
    );
  };

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
    // #759: the Wallet pass carries the static QR, valid all season.
    {
      name: "POST /licenses/my/wallet/apple",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post("/api/v1/licenses/my/wallet/apple")
          .set("Authorization", `Bearer ${token}`),
      service: () => walletPass.issueDownloadToken,
      ok: 201,
    },
    // #760: the renewal request can be read, never written, by support.
    {
      name: "POST /licenses/renewal/start",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post("/api/v1/licenses/renewal/start")
          .set("Authorization", `Bearer ${token}`),
      service: () => renewal.startRenewalRequest,
      ok: 201,
    },
    {
      name: "POST /licenses/renewal/:id/documents",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post(`/api/v1/licenses/renewal/${RENEWAL_ID}/documents`)
          .set("Authorization", `Bearer ${token}`)
          .field("type", "MEDICAL_CERTIFICATE")
          .attach("document", png, {
            filename: "certificat.png",
            contentType: "image/png",
          }),
      service: () => renewal.uploadRenewalDocument,
      ok: 201,
    },
    {
      name: "POST /licenses/renewal/:id/submit",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post(`/api/v1/licenses/renewal/${RENEWAL_ID}/submit`)
          .set("Authorization", `Bearer ${token}`),
      service: () => renewal.submitRenewalRequest,
      ok: 201,
    },
    // #761: writes that free a seat, end a couple or change a lasting setting.
    {
      name: "POST /competitions/:id/unregister",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post(`/api/v1/competitions/${EVENT_ID}/unregister`)
          .set("Authorization", `Bearer ${token}`)
          .send({ eventId: EVENT_ID }),
      service: () => registrations.unregister,
      ok: 201,
    },
    {
      name: "POST /competitions/unregister-member",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post("/api/v1/competitions/unregister-member")
          .set("Authorization", `Bearer ${token}`)
          .send({ eventId: EVENT_ID, userId: MEMBER_ID }),
      service: () => registrations.unregisterMember,
      ok: 201,
    },
    {
      name: "PATCH /clubs/me/partnerships/:id/end",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .patch("/api/v1/clubs/me/partnerships/p-1/end")
          .set("Authorization", `Bearer ${token}`)
          .send({ endDate: "2026-10-17" }),
      service: () => partnerships.endPartnership,
      ok: 200,
    },
    {
      name: "PATCH /clubs/me/registration-mode",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .patch("/api/v1/clubs/me/registration-mode")
          .set("Authorization", `Bearer ${token}`)
          .send({ registrationMode: "CLUB_ONLY" }),
      service: () => helloAsso.setRegistrationMode,
      ok: 200,
    },
    {
      name: "PATCH /users/me",
      send: (token: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .patch("/api/v1/users/me")
          .set("Authorization", `Bearer ${token}`)
          .send({ wdsf: null }),
      service: () => users.updateWdsf,
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

  describe("journal of the writes made under impersonation (#761)", () => {
    it("records a refused write with its session, route template and status", async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/v1/competitions/${EVENT_ID}/unregister?from=app`)
        .set("Authorization", `Bearer ${impersonationToken()}`)
        .send({ eventId: EVENT_ID })
        .expect(403);

      // Template only: neither the event id nor the query string.
      expect(await journalled(1)).toEqual([
        {
          impersonationLogId: LOG_ID,
          method: "POST",
          route: "/competitions/:id/unregister",
          statusCode: 403,
        },
      ]);
    });

    it("records an accepted write too (here: stopping the session)", async () => {
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/auth/impersonate/stop")
        .set("Authorization", `Bearer ${impersonationToken()}`);
      expect(response.status).toBeLessThan(300);

      expect(await journalled(1)).toEqual([
        {
          impersonationLogId: LOG_ID,
          method: "POST",
          route: "/auth/impersonate/stop",
          statusCode: response.status,
        },
      ]);
    });

    it("records neither reads nor the account's own writes", async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/clubs/me/registration-mode")
        .set("Authorization", `Bearer ${impersonationToken()}`);
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch("/api/v1/clubs/me/registration-mode")
        .set("Authorization", `Bearer ${clubToken()}`)
        .send({ registrationMode: "CLUB_ONLY" })
        .expect(200);

      expect(await journalled(1)).toEqual([]);
    });
  });
});
