/**
 * One webhook route per payment connector (#388, ADR-0023), over HTTP with
 * the REAL signature guard: the HelloAsso route and the historical one both
 * answer 401 on a missing or wrong `x-ha-signature` once a partner key is
 * configured, and process a correctly signed notification.
 */
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { createHmac, randomBytes } from "crypto";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { HelloAssoNotificationService } from "./../src/payment/helloasso-notification.service";
import { PaymentService } from "./../src/payment/payment.service";
import { SeatReleaseService } from "./../src/payment/seat-release.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

// Random per run: a test key, never a real one.
const SIGNATURE_KEY = randomBytes(16).toString("hex");

describe("Payment connector webhook routes (#388, e2e)", () => {
  let app: INestApplication;
  let previousKey: string | undefined;
  const resolveOrderNotification = jest.fn();
  const handleOrderWebhook = jest.fn().mockResolvedValue(undefined);

  const body = JSON.stringify({
    eventType: "Order",
    data: { id: 12345, checkoutIntentId: 4242 },
    metadata: { bookingId: "4c1b6f5e-6f2f-4d55-9d3a-3c0b0f2a9e11" },
  });
  const sign = (raw: string) =>
    createHmac("sha256", SIGNATURE_KEY).update(raw).digest("hex");

  beforeAll(async () => {
    previousKey = process.env.HELLOASSO_SIGNATURE_KEY;
    process.env.HELLOASSO_SIGNATURE_KEY = SIGNATURE_KEY;

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PaymentService)
        .useValue({ createCheckout: jest.fn(), handleOrderWebhook })
        .overrideProvider(HelloAssoNotificationService)
        .useValue({ resolveOrderNotification })
        .overrideProvider(SeatReleaseService)
        .useValue({ handlePaymentNotification: jest.fn() })
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(true),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        }),
    ).compile();

    // As in main.ts: the guard signs the raw body.
    app = moduleFixture.createNestApplication({ rawBody: true });
    await configureTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousKey === undefined) delete process.env.HELLOASSO_SIGNATURE_KEY;
    else process.env.HELLOASSO_SIGNATURE_KEY = previousKey;
  });

  beforeEach(() => {
    resolveOrderNotification.mockReset().mockResolvedValue(null);
    handleOrderWebhook.mockClear();
  });

  describe.each([
    ["/api/v1/payment/webhook/helloasso"],
    ["/api/v1/payment/webhook"],
  ])("POST %s", (path) => {
    const post = () =>
      request(app.getHttpServer())
        .post(path)
        .set("Content-Type", "application/json");

    it("answers 401 without a signature, before reading anything", async () => {
      await post().send(body).expect(401);
      expect(resolveOrderNotification).not.toHaveBeenCalled();
    });

    it("answers 401 on a wrong signature", async () => {
      await post()
        .set("x-ha-signature", sign(`${body} `))
        .send(body)
        .expect(401);
      expect(resolveOrderNotification).not.toHaveBeenCalled();
    });

    it("processes a correctly signed notification through the HelloAsso re-read", async () => {
      const verified = { eventType: "Order", data: { id: 12345 } };
      resolveOrderNotification.mockResolvedValue(verified);

      await post()
        .set("x-ha-signature", sign(body))
        .send(body)
        .expect(200, { received: true });
      expect(resolveOrderNotification).toHaveBeenCalledTimes(1);
      expect(handleOrderWebhook).toHaveBeenCalledWith(verified);
    });
  });
});
