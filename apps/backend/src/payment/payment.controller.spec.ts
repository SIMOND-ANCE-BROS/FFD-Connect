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
    confirmBooking: jest.fn(),
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
      amount: 1500,
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
    it("calls confirmBooking when eventType is Order and bookingId is present", async () => {
      mockPaymentService.confirmBooking.mockResolvedValue(undefined);

      const payload = {
        eventType: "Order",
        data: { metadata: { bookingId: "booking-1" } },
      };

      await controller.handleWebhook(payload);

      expect(mockPaymentService.confirmBooking).toHaveBeenCalledWith(
        "booking-1",
      );
    });

    it("returns { received: true } when eventType is Order", async () => {
      mockPaymentService.confirmBooking.mockResolvedValue(undefined);

      const result = await controller.handleWebhook({
        eventType: "Order",
        data: { metadata: { bookingId: "booking-1" } },
      });

      expect(result).toEqual({ received: true });
    });

    it("does not call confirmBooking when eventType is not Order", async () => {
      const result = await controller.handleWebhook({
        eventType: "Payment",
        data: { metadata: { bookingId: "booking-1" } },
      });

      expect(mockPaymentService.confirmBooking).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });

    it("does not call confirmBooking when metadata is absent", async () => {
      const result = await controller.handleWebhook({
        eventType: "Order",
        data: {},
      });

      expect(mockPaymentService.confirmBooking).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });

    it("does not call confirmBooking when bookingId is absent", async () => {
      const result = await controller.handleWebhook({
        eventType: "Order",
        data: { metadata: { bookingId: "" } },
      });

      expect(mockPaymentService.confirmBooking).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });
  });
});
