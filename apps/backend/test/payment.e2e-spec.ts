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
import { PaymentService } from "./../src/payment/payment.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("PaymentController (e2e)", () => {
  let app: INestApplication;
  let paymentService: { createCheckout: jest.Mock; confirmBooking: jest.Mock };

  const mockAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { userId: "user-1" };
      return true;
    },
  };

  beforeAll(async () => {
    paymentService = {
      createCheckout: jest.fn(),
      confirmBooking: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PaymentService)
        .useValue(paymentService)
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

  // ─── POST /payment/checkout ───────────────────────────────────────────────

  describe("POST /payment/checkout", () => {
    const validBody = {
      competitionId: "comp-1",
      itemId: "item-1",
      seatLabel: "A1",
      amount: 1500,
    };

    const mockIntent = {
      id: "intent-1",
      redirectUrl: "https://helloasso.com/checkout/intent-1",
    };

    it("returns 201 with checkout intent on success", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
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

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/checkout")
        .send(validBody)
        .expect(201);

      expect(paymentService.createCheckout).toHaveBeenCalledWith(
        "user-1",
        validBody,
      );
    });

    it("returns 400 when service throws BadRequestException", () => {
      paymentService.createCheckout.mockRejectedValue(
        new BadRequestException(
          "Le club organisateur n'a pas connecté HelloAsso",
        ),
      );

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/checkout")
        .send(validBody)
        .expect(400);
    });

    it("returns 400 when required field competitionId is missing", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/checkout")
        .send({ itemId: "item-1", amount: 1500 })
        .expect(400);
    });

    it("returns 400 when amount is not a number", () => {
      paymentService.createCheckout.mockResolvedValue(mockIntent);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/checkout")
        .send({ ...validBody, amount: "not-a-number" })
        .expect(400);
    });
  });

  // ─── POST /payment/webhook ────────────────────────────────────────────────

  describe("POST /payment/webhook", () => {
    it("returns 200 with { received: true } for Order events", () => {
      paymentService.confirmBooking.mockResolvedValue(undefined);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/webhook")
        .send({
          eventType: "Order",
          data: { metadata: { bookingId: "booking-1" } },
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ received: true });
        });
    });

    it("calls PaymentService.confirmBooking with bookingId for Order events", async () => {
      paymentService.confirmBooking.mockResolvedValue(undefined);

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/webhook")
        .send({
          eventType: "Order",
          data: { metadata: { bookingId: "booking-42" } },
        })
        .expect(200);

      expect(paymentService.confirmBooking).toHaveBeenCalledWith("booking-42");
    });

    it("does not call confirmBooking for non-Order events", async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/webhook")
        .send({
          eventType: "Payment",
          data: { metadata: { bookingId: "booking-1" } },
        })
        .expect(200);

      expect(paymentService.confirmBooking).not.toHaveBeenCalled();
    });

    it("does not call confirmBooking when metadata is absent", async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/webhook")
        .send({ eventType: "Order", data: {} })
        .expect(200);

      expect(paymentService.confirmBooking).not.toHaveBeenCalled();
    });

    it("returns 200 without auth (webhook is public)", () => {
      // Webhook doit être accessible sans JWT
      paymentService.confirmBooking.mockResolvedValue(undefined);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/payment/webhook")
        .send({ eventType: "Other", data: {} })
        .expect(200);
    });
  });
});
