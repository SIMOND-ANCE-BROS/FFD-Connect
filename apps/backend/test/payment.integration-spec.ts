/**
 * HelloAsso checkout + webhook on a real database (#381): the amount is fixed
 * server-side from the competition layout, stored on the booking, and the
 * webhook only confirms a paid order of that exact amount.
 *
 * #401/#402: a seat has at most one active booking (PENDING hold or
 * CONFIRMED), enforced by the partial unique index, and a lapsed hold neither
 * blocks the seat nor gets confirmed by a late payment.
 */
import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import * as Sentry from "@sentry/nestjs";
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
  let otherUserId: string;
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
    otherUserId = (await f.user()).user.id;
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
    await prisma.seatBooking.deleteMany({ where: { competitionId } });
    await f.cleanup();
    await moduleRef.close();
  });

  let intentCounter = 4000;
  // Each test starts with every seat free (#402: one active booking per seat).
  afterEach(async () => {
    await prisma.seatBooking.deleteMany({ where: { competitionId } });
  });

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
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

  const expire = (bookingId: string) =>
    prisma.seatBooking.update({
      where: { id: bookingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

  const statusOf = async (bookingId: string) =>
    (
      await prisma.seatBooking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true },
      })
    ).status;

  describe("one active booking per seat (#402)", () => {
    it("lets only one of two concurrent checkouts on the same seat through", async () => {
      const results = await Promise.allSettled([
        service.createCheckout(userId, { competitionId, itemId: "table-1" }),
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-1",
        }),
      ]);

      const rejected = results.filter((r) => r.status === "rejected");
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(createCheckoutIntent).toHaveBeenCalledTimes(1);
      expect(
        await prisma.seatBooking.count({
          where: { competitionId, itemId: "table-1" },
        }),
      ).toBe(1);
    });

    it("refuses (409) a seat already sold, before any HelloAsso intent", async () => {
      const booking = await checkout();
      await service.handleOrderWebhook(
        order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
      );
      createCheckoutIntent.mockClear();

      await expect(
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-1",
        }),
      ).rejects.toThrow(ConflictException);
      expect(createCheckoutIntent).not.toHaveBeenCalled();
    });

    it("rejects a second active booking at the database level", async () => {
      const data = {
        competitionId,
        userId,
        itemId: "table-1",
        status: "CONFIRMED" as const,
      };
      await prisma.seatBooking.create({ data });

      await expect(
        prisma.seatBooking.create({
          data: { ...data, userId: otherUserId, status: "PENDING" },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("does not let a cancelled booking block the seat", async () => {
      const booking = await checkout();
      await prisma.seatBooking.update({
        where: { id: booking.id },
        data: { status: "CANCELLED" },
      });

      await expect(
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-1",
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("expiry of temporary holds (#401)", () => {
    it("frees the seat of a lapsed hold for the next checkout", async () => {
      const first = await checkout();
      await expire(first.id);

      await service.createCheckout(otherUserId, {
        competitionId,
        itemId: "table-1",
      });

      expect(await statusOf(first.id)).toBe("EXPIRED");
      const second = await prisma.seatBooking.findFirstOrThrow({
        where: { userId: otherUserId, competitionId },
      });
      expect(second.status).toBe("PENDING");
      expect(second.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("never confirms a late payment and flags it for refund", async () => {
      const booking = await checkout();
      await expire(booking.id);

      await service.handleOrderWebhook(
        order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
      );

      expect(await statusOf(booking.id)).toBe("EXPIRED");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "HelloAsso order rejected",
        expect.objectContaining({
          tags: expect.objectContaining({
            reason: "booking_expired",
            refund: "required",
          }),
        }),
      );
    });

    it("does not hand the seat back to a late payer once someone else holds it", async () => {
      const late = await checkout();
      const lateIntent = intentCounter;
      await expire(late.id);
      await service.createCheckout(otherUserId, {
        competitionId,
        itemId: "table-1",
      });

      await service.handleOrderWebhook({
        ...order(late.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
        data: {
          id: 98765,
          checkoutIntentId: lateIntent,
          payments: [{ amount: SEAT_PRICE_CENTS, state: "Authorized" }],
        },
      });

      expect(await statusOf(late.id)).toBe("EXPIRED");
      expect(
        await prisma.seatBooking.count({
          where: { competitionId, itemId: "table-1", status: "CONFIRMED" },
        }),
      ).toBe(0);
    });
  });
});
