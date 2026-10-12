/**
 * HelloAsso checkout + webhook on a real database (#381): the amount is fixed
 * server-side from the competition layout, stored on the booking, and the
 * webhook only confirms a paid order of that exact amount.
 */
import { TestingModule } from "@nestjs/testing";
import { ClubsHelloAssoService } from "../src/clubs/clubs-helloasso.service";
import { WebhookPayloadDto } from "../src/payment/dto/webhook-payload.dto";
import { HelloAssoService } from "../src/payment/hello-asso.service";
import { PaymentService } from "../src/payment/payment.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

jest.mock("@sentry/nestjs", () => ({
  ...jest.requireActual("@sentry/nestjs"),
  captureMessage: jest.fn(),
}));

describe("Payment checkout + HelloAsso webhook (integration, real DB)", () => {
  const suffix = `payment-381-${Date.now()}`;
  const SEAT_PRICE_CENTS = 1500;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PaymentService;
  let f: ReturnType<typeof createFactories>;
  let userId: string;
  let competitionId: string;

  const createCheckoutIntent = jest.fn();

  beforeAll(async () => {
    const built = await buildServiceModule({
      extra: (builder) =>
        builder
          .overrideProvider(HelloAssoService)
          .useValue({ createCheckoutIntent })
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
    service = moduleRef.get(PaymentService);
    f = createFactories(prisma, suffix);

    userId = (await f.user()).user.id;
    competitionId = (
      await f.competition({
        layout: [
          { id: "table-1", label: "Table 1", priceCents: SEAT_PRICE_CENTS },
          { id: "table-free", label: "Table sans tarif" },
        ],
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({ where: { userId } });
    await f.cleanup();
    await moduleRef.close();
  });

  let intentCounter = 4000;
  beforeEach(() => {
    createCheckoutIntent.mockReset();
    createCheckoutIntent.mockImplementation(() =>
      Promise.resolve({ id: ++intentCounter, redirectUrl: "https://ha" }),
    );
  });

  const checkout = async () => {
    await service.createCheckout(userId, {
      competitionId,
      itemId: "table-1",
      seatLabel: "Place 1",
      amount: 1, // tampered by the client: must be ignored
    });
    return prisma.seatBooking.findFirstOrThrow({
      where: { userId, paymentId: String(intentCounter) },
    });
  };

  const order = (
    bookingId: string,
    paid: { amount: number; state: string },
    overrides: Partial<WebhookPayloadDto["data"]> = {},
  ): WebhookPayloadDto => ({
    eventType: "Order",
    metadata: { bookingId, competitionId },
    data: {
      id: 98765,
      checkoutIntentId: intentCounter,
      payments: [paid],
      ...overrides,
    },
  });

  it("stores the server-side price and charges it, whatever the client sent", async () => {
    const booking = await checkout();

    expect(booking.status).toBe("PENDING");
    expect(booking.expectedAmountCents).toBe(SEAT_PRICE_CENTS);
    expect(createCheckoutIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ amount: SEAT_PRICE_CENTS }),
    );
  });

  it("refuses the checkout of a seat without a price", async () => {
    await expect(
      service.createCheckout(userId, { competitionId, itemId: "table-free" }),
    ).rejects.toThrow(/Aucun tarif/);
    expect(createCheckoutIntent).not.toHaveBeenCalled();
  });

  it.each([
    ["an unpaid order", { amount: SEAT_PRICE_CENTS, state: "Refused" }, {}],
    ["a lower amount", { amount: 1, state: "Authorized" }, {}],
    [
      "another checkout intent",
      { amount: SEAT_PRICE_CENTS, state: "Authorized" },
      { checkoutIntentId: 1 },
    ],
  ])("keeps the booking PENDING for %s", async (_label, paid, overrides) => {
    const booking = await checkout();

    await service.handleOrderWebhook(order(booking.id, paid, overrides));

    const after = await prisma.seatBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.status).toBe("PENDING");
  });

  it("keeps the booking PENDING for another competition", async () => {
    const booking = await checkout();
    const payload = order(booking.id, {
      amount: SEAT_PRICE_CENTS,
      state: "Authorized",
    });
    payload.metadata = { bookingId: booking.id, competitionId: "other" };

    await service.handleOrderWebhook(payload);

    const after = await prisma.seatBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.status).toBe("PENDING");
  });

  it("never revives a cancelled booking, even for a correct payment", async () => {
    const booking = await checkout();
    await prisma.seatBooking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });

    await service.handleOrderWebhook(
      order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
    );

    const after = await prisma.seatBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.status).toBe("CANCELLED");
  });

  it("confirms the booking for a paid order of the expected amount", async () => {
    const booking = await checkout();

    await service.handleOrderWebhook(
      order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
    );

    const after = await prisma.seatBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.status).toBe("CONFIRMED");
  });
});
