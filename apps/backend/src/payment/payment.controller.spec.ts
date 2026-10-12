import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";

describe("PaymentController", () => {
  let controller: PaymentController;
  const mockPaymentService = {
    createCheckout: jest.fn(),
    handleOrderWebhook: jest.fn(),
  };

  const mockRequest = {
    user: { userId: "user-1" },
  } as unknown as RequestWithUser;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    })
      .overrideGuard(WebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentController>(PaymentController);
  });

  describe("createCheckout", () => {
    const dto = {
      competitionId: "comp-1",
      itemId: "item-1",
      seatLabel: "A1",
    };
    const intent = {
      id: "intent-1",
      redirectUrl: "https://helloasso.com/checkout/intent-1",
    };

    it("calls paymentService.createCheckout with userId from JWT and body", async () => {
      mockPaymentService.createCheckout.mockResolvedValue(intent);

      await controller.createCheckout(mockRequest, dto);

      expect(mockPaymentService.createCheckout).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
    });

    it("returns the checkout intent", async () => {
      mockPaymentService.createCheckout.mockResolvedValue(intent);

      const result = await controller.createCheckout(mockRequest, dto);

      expect(result).toEqual(intent);
    });

    it("propagates errors from the service", async () => {
      mockPaymentService.createCheckout.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(controller.createCheckout(mockRequest, dto)).rejects.toThrow(
        "Service error",
      );
    });
  });

  describe("handleWebhook", () => {
    it("delegates Order events to paymentService.handleOrderWebhook", async () => {
      mockPaymentService.handleOrderWebhook.mockResolvedValue(undefined);
      const payload = {
        eventType: "Order",
        metadata: { bookingId: "booking-1" },
        data: { id: 1, payments: [{ amount: 1500, state: "Authorized" }] },
      };

      const result = await controller.handleWebhook(payload);

      expect(mockPaymentService.handleOrderWebhook).toHaveBeenCalledWith(
        payload,
      );
      expect(result).toEqual({ received: true });
    });

    it("ignores non-Order events", async () => {
      const result = await controller.handleWebhook({
        eventType: "Payment",
        metadata: { bookingId: "booking-1" },
        data: {},
      });

      expect(mockPaymentService.handleOrderWebhook).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });

    it("propagates unexpected errors (HelloAsso will retry)", async () => {
      mockPaymentService.handleOrderWebhook.mockRejectedValue(
        new Error("DB down"),
      );

      await expect(
        controller.handleWebhook({ eventType: "Order", data: {} }),
      ).rejects.toThrow("DB down");
    });
  });
});
