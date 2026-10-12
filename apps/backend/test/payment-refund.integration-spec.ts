/**
 * #403 on a real database: a HelloAsso refund or dispute releases a
 * confirmed seat — once, and only when HelloAsso's API confirms it.
 */
import { TestingModule } from "@nestjs/testing";
import { ClubsHelloAssoService } from "../src/clubs/clubs-helloasso.service";
import { WebhookPayloadDto } from "../src/payment/dto/webhook-payload.dto";
import { HelloAssoService } from "../src/payment/hello-asso.service";
import { PaymentController } from "../src/payment/payment.controller";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

jest.mock("@sentry/nestjs", () => ({
  ...jest.requireActual("@sentry/nestjs"),
  captureMessage: jest.fn(),
}));

describe("HelloAsso refund / dispute releases the seat (#403, real DB)", () => {
  const suffix = `payment-403-${Date.now()}`;
  const CHECKOUT_INTENT_ID = 4242;
  const PAYMENT_ID = 555;
  const ORDER_ID = 98765;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: PaymentController;
  let f: ReturnType<typeof createFactories>;
  let userId: string;
  let competitionId: string;

  const getPayment = jest.fn();
  const getOrder = jest.fn();
  let seatCounter = 0;

  beforeAll(async () => {
    const built = await buildServiceModule({
      extra: (builder) =>
        builder
          .overrideProvider(HelloAssoService)
          .useValue({
            createCheckoutIntent: jest.fn(),
            getCheckoutIntent: jest.fn(),
            getPayment,
            getOrder,
          })
          .overrideProvider(ClubsHelloAssoService)
          .useValue({
            getHelloAssoCredentialsForCompetition: jest.fn().mockResolvedValue({
              clientId: "client",
              clientSecret: "secret",
              organizationSlug: "club",
            }),
          }),
    });
    moduleRef = built.module;
    prisma = built.prisma;
    controller = moduleRef.get(PaymentController);
    f = createFactories(prisma, suffix);
    userId = (await f.user()).user.id;
    competitionId = (await f.competition({})).id;
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({ where: { userId } });
    await f.cleanup();
    await moduleRef.close();
  });

  beforeEach(() => {
    getPayment.mockReset();
    getOrder.mockReset();
  });

  const confirmedBooking = () =>
    prisma.seatBooking.create({
      data: {
        competitionId,
        userId,
        itemId: `table-${++seatCounter}`,
        status: "CONFIRMED",
        paymentId: String(CHECKOUT_INTENT_ID),
        expectedAmountCents: 1500,
      },
    });

  /** HelloAsso `Payment` notification, as documented (trimmed). */
  const notification = (
    bookingId: string,
    state: string,
  ): WebhookPayloadDto => ({
    eventType: "Payment",
    metadata: { bookingId, competitionId },
    data: { id: PAYMENT_ID, state },
  });

  const helloAssoSays = (
    state: string,
    checkoutIntentId = CHECKOUT_INTENT_ID,
  ) =>
    getPayment.mockResolvedValue({
      found: true,
      value: {
        id: PAYMENT_ID,
        amount: 1500,
        state,
        order: { id: ORDER_ID, checkoutIntentId },
      },
    });

  const statusOf = async (id: string) =>
    prisma.seatBooking.findUniqueOrThrow({
      where: { id },
      select: { status: true, cancelReason: true },
    });

  it("releases the seat when HelloAsso confirms the refund", async () => {
    const booking = await confirmedBooking();
    helloAssoSays("Refunded");

    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect(await statusOf(booking.id)).toEqual({
      status: "CANCELLED",
      cancelReason: "HELLOASSO_REFUNDED",
    });
    expect(getPayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: "club" }),
      String(PAYMENT_ID),
    );
  });

  it("releases the seat when the payer disputes the payment", async () => {
    const booking = await confirmedBooking();
    helloAssoSays("Contested");

    await controller.handleWebhook(notification(booking.id, "Contested"));

    expect(await statusOf(booking.id)).toEqual({
      status: "CANCELLED",
      cancelReason: "HELLOASSO_CONTESTED",
    });
  });

  it("is idempotent: a redelivered refund changes nothing more", async () => {
    const booking = await confirmedBooking();
    helloAssoSays("Refunded");

    await controller.handleWebhook(notification(booking.id, "Refunded"));
    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect(await statusOf(booking.id)).toEqual({
      status: "CANCELLED",
      cancelReason: "HELLOASSO_REFUNDED",
    });
    // The second delivery stops at the booking status, before HelloAsso.
    expect(getPayment).toHaveBeenCalledTimes(1);
  });

  it("keeps the seat on a forged refund: HelloAsso still says Authorized", async () => {
    const booking = await confirmedBooking();
    helloAssoSays("Authorized");

    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect(await statusOf(booking.id)).toEqual({
      status: "CONFIRMED",
      cancelReason: null,
    });
  });

  it("keeps the seat when the refunded payment belongs to another checkout", async () => {
    const booking = await confirmedBooking();
    helloAssoSays("Refunded", 9999);

    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect((await statusOf(booking.id)).status).toBe("CONFIRMED");
  });

  it("reads the checkout intent from the order when the payment omits it", async () => {
    const booking = await confirmedBooking();
    getPayment.mockResolvedValue({
      found: true,
      value: { id: PAYMENT_ID, state: "Refunded", order: { id: ORDER_ID } },
    });
    getOrder.mockResolvedValue({
      found: true,
      value: { id: ORDER_ID, checkoutIntentId: CHECKOUT_INTENT_ID },
    });

    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect(getOrder).toHaveBeenCalledWith(expect.anything(), String(ORDER_ID));
    expect((await statusOf(booking.id)).status).toBe("CANCELLED");
  });

  it("ignores a notification about an unknown booking", async () => {
    await expect(
      controller.handleWebhook(
        notification("6f1c2b6e-8a4d-4c1e-9b7a-2d5e6f708192", "Refunded"),
      ),
    ).resolves.toEqual({ received: true });
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("ignores payment states that do not release a seat", async () => {
    const booking = await confirmedBooking();

    await controller.handleWebhook(notification(booking.id, "Authorized"));

    expect((await statusOf(booking.id)).status).toBe("CONFIRMED");
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("asks HelloAsso to redeliver a refund while the booking is still PENDING", async () => {
    const booking = await confirmedBooking();
    await prisma.seatBooking.update({
      where: { id: booking.id },
      data: { status: "PENDING" },
    });
    helloAssoSays("Refunded");

    await expect(
      controller.handleWebhook(notification(booking.id, "Refunded")),
    ).rejects.toThrow(); // 503
    expect((await statusOf(booking.id)).status).toBe("PENDING");
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("never touches a booking that is already cancelled", async () => {
    const booking = await confirmedBooking();
    await prisma.seatBooking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });
    helloAssoSays("Refunded");

    await controller.handleWebhook(notification(booking.id, "Refunded"));

    expect(await statusOf(booking.id)).toEqual({
      status: "CANCELLED",
      cancelReason: null,
    });
    expect(getPayment).not.toHaveBeenCalled();
  });
});
