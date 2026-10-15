import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import type { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentController } from "./payment.controller";
import type { PaymentService } from "./payment.service";
import type { SeatReleaseService } from "./seat-release.service";

/** One webhook route per connector (#388, ADR-0023). */
describe("PaymentController connector webhook routes (#388)", () => {
  const route = (method: keyof PaymentController) => {
    const handler = PaymentController.prototype[method] as object;
    return {
      path: Reflect.getMetadata(PATH_METADATA, handler) as string,
      verb: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
      guards: Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[],
    };
  };

  it("serves HelloAsso on its own route, behind the same signature guard as the historical one", () => {
    expect(route("handleHelloAssoWebhook")).toEqual({
      path: "webhook/helloasso",
      verb: RequestMethod.POST,
      guards: [WebhookSignatureGuard],
    });
    expect(route("handleWebhook")).toEqual({
      path: "webhook",
      verb: RequestMethod.POST,
      guards: [WebhookSignatureGuard],
    });
  });

  it("processes the HelloAsso route exactly like the historical one (order re-read from HelloAsso)", async () => {
    const verified = { eventType: "Order", data: { id: 1 } };
    const resolveOrderNotification = jest.fn().mockResolvedValue(verified);
    const handleOrderWebhook = jest.fn().mockResolvedValue(undefined);
    const handlePaymentNotification = jest.fn().mockResolvedValue(undefined);
    const controller = new PaymentController(
      { handleOrderWebhook } as unknown as PaymentService,
      { resolveOrderNotification } as unknown as HelloAssoNotificationService,
      { handlePaymentNotification } as unknown as SeatReleaseService,
    );
    const order = { eventType: "Order", data: { id: 1 } } as WebhookPayloadDto;
    const payment = {
      eventType: "Payment",
      data: { id: 2 },
    } as WebhookPayloadDto;

    await expect(controller.handleHelloAssoWebhook(order)).resolves.toEqual({
      received: true,
    });
    await controller.handleHelloAssoWebhook(payment);

    expect(resolveOrderNotification).toHaveBeenCalledWith(order);
    expect(handleOrderWebhook).toHaveBeenCalledWith(verified);
    expect(handlePaymentNotification).toHaveBeenCalledWith(payment);
  });
});
