import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { WebhookSignatureGuard } from "./../src/payment/guards/webhook-signature.guard";
import { HelloAssoNotificationService } from "./../src/payment/helloasso-notification.service";
import { SeatReleaseService } from "./../src/payment/seat-release.service";
import { PaymentService } from "./../src/payment/payment.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("PaymentController (e2e)", () => {
  let app: INestApplication;
  let paymentService: {
    createCheckout: jest.Mock;
    handleOrderWebhook: jest.Mock;
  };

  const mockAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { userId: "user-1" };
      return true;
    },
  };

  const seatReleaseService = {
    handlePaymentNotification: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    paymentService = {
      createCheckout: jest.fn(),
      handleOrderWebhook: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PaymentService)
        .useValue(paymentService)
        // Passthrough: this suite checks HTTP parsing; the API re-read (#404)
        // is covered by helloasso-notification.service.spec.ts.
        .overrideProvider(HelloAssoNotificationService)
        .useValue({
          resolveOrderNotification: jest.fn((payload: unknown) =>
            Promise.resolve(payload),
          ),
        })
        .overrideProvider(SeatReleaseService)
        .useValue(seatReleaseService)
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
        })
        .overrideGuard(JwtAuthGuard)
        .useValue(mockAuthGuard)
        .overrideGuard(WebhookSignatureGuard)
        .useValue({ canActivate: () => true }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  // ─── POST /payment/checkout ───────────────────────────────────────────────

  describe("POST /payment/checkout", () => {
    const validBody = {
      competitionId: "comp-1",
      itemId: "item-1",
      seatLabel: "A1",
    };

    const mockIntent = {
      id: "intent-1",
      redirectUrl: "https://helloasso.com/checkout/intent-1",
    };

    it("returns 201 with checkout intent on success", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(http())
        .post("/api/v1/payment/checkout")
        .send(validBody)
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBe("intent-1");
          expect(res.body.redirectUrl).toBe(mockIntent.redirectUrl);
        });
    });

    it("calls PaymentService.createCheckout with userId from JWT and body", async () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      await request(http())
        .post("/api/v1/payment/checkout")
        .send(validBody)
        .expect(201);

      expect(paymentService.createCheckout).toHaveBeenCalledWith(
        "user-1",
        validBody,
      );
    });

    it("still accepts the deprecated amount sent by older clients (#381)", async () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      await request(http())
        .post("/api/v1/payment/checkout")
        .send({ ...validBody, amount: 1 })
        .expect(201);
    });

    it("returns 400 when service throws BadRequestException", () => {
      paymentService.createCheckout.mockRejectedValue(
        new BadRequestException(
          "Le club organisateur n'a pas connecté HelloAsso",
        ),
      );

      return request(http())
        .post("/api/v1/payment/checkout")
        .send(validBody)
        .expect(400);
    });

    it("returns 400 when required field competitionId is missing", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(http())
        .post("/api/v1/payment/checkout")
        .send({ itemId: "item-1" })
        .expect(400);
    });

    it("returns 400 when amount is not a number", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(http())
        .post("/api/v1/payment/checkout")
        .send({ ...validBody, amount: "not-a-number" })
        .expect(400);
    });
  });

  // ─── POST /payment/webhook ────────────────────────────────────────────────

  describe("POST /payment/webhook", () => {
    /** Shape of a real HelloAsso `Order` notification (trimmed). */
    const helloAssoOrder = {
      eventType: "Order",
      data: {
        id: 98765,
        checkoutIntentId: 4242,
        formSlug: "checkout",
        formType: "Checkout",
        organizationSlug: "club",
        date: "2026-10-12T10:00:00+02:00",
        payer: { email: "payer@example.com", firstName: "A", lastName: "B" },
        amount: { total: 1500, vat: 0, discount: 0 },
        items: [{ id: 1, amount: 1500, state: "Processed", type: "Payment" }],
        payments: [
          {
            id: 555,
            amount: 1500,
            state: "Authorized",
            paymentMeans: "Card",
            cashOutState: "Transfered",
            refundOperations: [],
          },
        ],
      },
      metadata: { bookingId: "booking-1", competitionId: "comp-1" },
    };

    it("accepts a real HelloAsso payload with undeclared fields (no 400)", async () => {
      paymentService.handleOrderWebhook.mockResolvedValue(undefined);

      await request(http())
        .post("/api/v1/payment/webhook")
        .send(helloAssoOrder)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ received: true });
        });

      expect(paymentService.handleOrderWebhook).toHaveBeenCalledTimes(1);
      const payload = paymentService.handleOrderWebhook.mock.calls[0][0];
      // Declared fields are kept, undeclared ones (payer…) are stripped.
      expect(payload.metadata).toEqual({
        bookingId: "booking-1",
        competitionId: "comp-1",
      });
      expect(payload.data.id).toBe(98765);
      expect(payload.data.checkoutIntentId).toBe(4242);
      expect(payload.data.payments).toEqual([
        { id: 555, amount: 1500, state: "Authorized" },
      ]);
      expect(payload.data.payer).toBeUndefined();
      expect(payload.data.items).toBeUndefined();
    });

    it("still accepts the legacy data.metadata location", async () => {
      paymentService.handleOrderWebhook.mockResolvedValue(undefined);

      await request(http())
        .post("/api/v1/payment/webhook")
        .send({
          eventType: "Order",
          data: { metadata: { bookingId: "booking-42" } },
        })
        .expect(200);

      const payload = paymentService.handleOrderWebhook.mock.calls[0][0];
      expect(payload.data.metadata).toEqual({ bookingId: "booking-42" });
    });

    it("returns 400 when a used field has the wrong type", () => {
      return request(http())
        .post("/api/v1/payment/webhook")
        .send({
          ...helloAssoOrder,
          data: {
            ...helloAssoOrder.data,
            payments: [{ amount: "1500", state: "Authorized" }],
          },
        })
        .expect(400);
    });

    it("hands a real Payment notification to the seat release (#403)", async () => {
      await request(http())
        .post("/api/v1/payment/webhook")
        .send({
          eventType: "Payment",
          data: {
            id: 555,
            amount: 1500,
            state: "Refunded",
            order: { id: 98765, formType: "Checkout" },
            payer: { email: "payer@example.com" },
            refundOperations: [{ id: 419, amount: 1500, status: "PROCESSED" }],
          },
          metadata: { bookingId: "booking-1", competitionId: "comp-1" },
        })
        .expect(200);

      expect(paymentService.handleOrderWebhook).not.toHaveBeenCalled();
      expect(
        seatReleaseService.handlePaymentNotification,
      ).toHaveBeenCalledTimes(1);
      const payload =
        seatReleaseService.handlePaymentNotification.mock.calls[0][0];
      // Declared fields kept (payment id, state), the rest stripped.
      expect(payload.data).toEqual({ id: 555, state: "Refunded" });
      expect(payload.metadata.bookingId).toBe("booking-1");
    });

    it("returns 200 without auth (webhook is public)", () => {
      return request(http())
        .post("/api/v1/payment/webhook")
        .send({ eventType: "Other", data: {} })
        .expect(200);
    });
  });
});
