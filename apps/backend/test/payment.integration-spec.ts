/**
 * HelloAsso checkout + webhook on a real database (#381): the amount is fixed
 * server-side from the competition layout, stored on the booking, and the
 * webhook only confirms a paid order of that exact amount.
 *
 * #401/#402: a seat has at most one active booking (PENDING hold or
 * CONFIRMED), enforced by the partial unique index, and a lapsed hold neither
 * blocks the seat nor gets confirmed by a late payment.
 *
 * #428: sold per seat (numbered seats, free-placement capacity), at most 4
 * PENDING bookings per user and competition, payment resume, refund owed —
 * the guarantees live in the database and hold under concurrency.
 */
import { ConflictException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { TestingModule } from "@nestjs/testing";
import * as Sentry from "@sentry/nestjs";
import { ClubsHelloAssoService } from "../src/clubs/clubs-helloasso.service";
import { WebhookPayloadDto } from "../src/payment/dto/webhook-payload.dto";
import { HelloAssoService } from "../src/payment/hello-asso.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { HelloAssoNotificationService } from "../src/payment/helloasso-notification.service";
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
  let clubManagerId: string;

  const createCheckoutIntent = jest.fn();
  const getCheckoutIntent = jest.fn();

  beforeAll(async () => {
    const built = await buildServiceModule({
      extra: (builder) =>
        builder
          .overrideProvider(HelloAssoService)
          .useValue({ createCheckoutIntent, getCheckoutIntent })
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
    const club = await f.club();
    clubManagerId = (await f.user(UserRole.CLUB, { clubId: club.id })).user.id;
    competitionId = (
      await f.competition({
        organizer: club.name,
        layout: [
          // Pre-#428 element: no capacity → one place, sold whole as before.
          { id: "table-1", label: "Table 1", priceCents: SEAT_PRICE_CENTS },
          { id: "table-free", label: "Table sans tarif" },
          {
            id: "table-8",
            type: "TABLE",
            label: "Table 8",
            capacity: 8,
            lockedSeats: [7],
            priceCents: SEAT_PRICE_CENTS,
          },
          {
            id: "stand",
            type: "GRADIN",
            rows: 2,
            cols: 3,
            capacity: 6,
            priceCents: 900,
          },
          { id: "chairs", type: "OTHER", capacity: 3, priceCents: 500 },
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
    getCheckoutIntent.mockReset();
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

  describe("notification verified by re-reading HelloAsso (#404)", () => {
    const process = async (payload: WebhookPayloadDto) => {
      const verifier = moduleRef.get(HelloAssoNotificationService);
      const verified = await verifier.resolveOrderNotification(payload);
      if (verified) await service.handleOrderWebhook(verified);
    };

    it("never confirms on a forged notification while HelloAsso has no paid order", async () => {
      const booking = await checkout();
      getCheckoutIntent.mockResolvedValue({
        found: true,
        value: {
          id: intentCounter,
          metadata: { bookingId: booking.id, competitionId },
        },
      });

      await expect(
        process(
          order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
        ),
      ).rejects.toThrow(); // 503: HelloAsso will redeliver

      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.status).toBe("PENDING");
      expect(getCheckoutIntent).toHaveBeenCalledWith(
        expect.objectContaining({ organizationSlug: "club" }),
        String(intentCounter),
      );
    });

    it("keeps PENDING when HelloAsso reports a smaller amount than the notification", async () => {
      const booking = await checkout();
      getCheckoutIntent.mockResolvedValue({
        found: true,
        value: {
          id: intentCounter,
          metadata: { bookingId: booking.id, competitionId },
          order: {
            id: 98765,
            checkoutIntentId: intentCounter,
            payments: [{ id: 1, amount: 1, state: "Authorized" }],
          },
        },
      });

      await process(
        order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
      );

      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.status).toBe("PENDING");
    });

    it("confirms when HelloAsso's own order is paid in full", async () => {
      const booking = await checkout();
      getCheckoutIntent.mockResolvedValue({
        found: true,
        value: {
          id: intentCounter,
          metadata: { bookingId: booking.id, competitionId },
          order: {
            id: 98765,
            checkoutIntentId: intentCounter,
            payments: [
              { id: 1, amount: SEAT_PRICE_CENTS, state: "Authorized" },
            ],
          },
        },
      });

      // The notification body itself is empty: only the API re-read counts.
      await process({
        eventType: "Order",
        metadata: { bookingId: booking.id },
        data: {},
      });

      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.status).toBe("CONFIRMED");
    });
  });
  describe("per-seat booking rules (#428)", () => {
    const users: string[] = [];
    const userAt = async (i: number) => {
      while (users.length <= i) users.push((await f.user()).user.id);
      return users[i];
    };

    it("sells the seats of one table separately, one active booking per seat", async () => {
      const thirdUser = await userAt(0);
      const results = await Promise.allSettled([
        service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 2,
        }),
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 2,
        }),
        service.createCheckout(thirdUser, {
          competitionId,
          itemId: "table-8",
          seatIndex: 3,
        }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      const seats = await prisma.seatBooking.findMany({
        where: { competitionId, itemId: "table-8" },
        select: { seatIndex: true },
        orderBy: { seatIndex: "asc" },
        take: 10,
      });
      expect(seats.map((s) => s.seatIndex)).toEqual([2, 3]);
    });

    it("refuses a locked or non-existent seat", async () => {
      await expect(
        service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 7,
        }),
      ).rejects.toThrow(/pas réservable/);
      await expect(
        service.createCheckout(userId, {
          competitionId,
          itemId: "stand",
          seatIndex: 6,
        }),
      ).rejects.toThrow(/n'existe pas/);
    });

    it("assigns the first free seat to a request without seat index (old shape)", async () => {
      await service.createCheckout(userId, {
        competitionId,
        itemId: "stand",
        seatIndex: 0,
      });

      const result = await service.createCheckout(otherUserId, {
        competitionId,
        itemId: "stand",
        seatLabel: "n'importe",
      });

      expect(result.seatIndex).toBe(1);
      expect(createCheckoutIntent).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({ amount: 900 }),
      );
    });

    it("never sells more free places than the capacity, under concurrency", async () => {
      const buyers = await Promise.all([0, 1, 2, 3, 4, 5].map(userAt));

      const results = await Promise.allSettled(
        buyers.map((buyer) =>
          service.createCheckout(buyer, { competitionId, itemId: "chairs" }),
        ),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      for (const r of results) {
        if (r.status === "fulfilled") expect(r.value.seatIndex).toBeNull();
      }
      expect(
        await prisma.seatBooking.count({
          where: { competitionId, itemId: "chairs", status: "PENDING" },
        }),
      ).toBe(3);
    });

    it("caps a user at 4 pending bookings per competition, under concurrency", async () => {
      const results = await Promise.allSettled(
        [0, 1, 2, 3, 4, 5].map((seatIndex) =>
          service.createCheckout(userId, {
            competitionId,
            itemId: "table-8",
            seatIndex,
          }),
        ),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(rejected).toHaveLength(2);
      expect(
        await prisma.seatBooking.count({
          where: { competitionId, userId, status: "PENDING" },
        }),
      ).toBe(4);
    });

    it("frees a pending slot once a booking is paid", async () => {
      for (const seatIndex of [0, 1, 2, 3]) {
        await service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex,
        });
      }
      const first = await prisma.seatBooking.findFirstOrThrow({
        where: { competitionId, userId, seatIndex: 0 },
      });
      await prisma.seatBooking.update({
        where: { id: first.id },
        data: { status: "CONFIRMED" },
      });

      await expect(
        service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 4,
        }),
      ).resolves.toEqual(expect.objectContaining({ seatIndex: 4 }));
    });

    it("enforces the pending cap and the seat index in the database", async () => {
      const base = {
        competitionId,
        userId,
        itemId: "table-8",
        status: "PENDING" as const,
      };
      await prisma.seatBooking.create({
        data: { ...base, seatIndex: 0, pendingSlot: 0 },
      });

      await expect(
        prisma.seatBooking.create({
          data: { ...base, seatIndex: 1, pendingSlot: 0 },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      // The CHECK constraints (pendingSlot 0..3, seatIndex >= 0) come from
      // the migration SQL: not present on a `db push` database (CI).
    });

    it("keeps the old revision's guarantee for rows without seat index (rollback)", async () => {
      const legacy = {
        competitionId,
        itemId: "table-8",
        status: "PENDING" as const,
      };
      await prisma.seatBooking.create({
        data: {
          ...legacy,
          userId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await expect(
        prisma.seatBooking.create({
          data: { ...legacy, userId: otherUserId, status: "CONFIRMED" },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      // And the new code never sells a seat of an element held whole.
      await expect(
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    describe("resume", () => {
      it("returns the same HelloAsso page instead of a 409", async () => {
        const first = await service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 5,
        });

        const again = await service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 5,
        });

        expect(again).toEqual({ ...first, resumed: true });
        expect(createCheckoutIntent).toHaveBeenCalledTimes(1);
      });

      it("creates a fresh intent once the page expired, and confirms a payment on the earlier one", async () => {
        const first = await service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 5,
        });
        await prisma.seatBooking.update({
          where: { id: first.bookingId },
          data: { checkoutCreatedAt: new Date(Date.now() - 20 * 60 * 1000) },
        });
        getCheckoutIntent.mockResolvedValue({
          found: true,
          value: { id: first.id },
        });

        const again = await service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 5,
        });

        expect(again.id).not.toBe(first.id);
        expect(again.bookingId).toBe(first.bookingId);
        const resumed = await prisma.seatBooking.findUniqueOrThrow({
          where: { id: first.bookingId },
        });
        expect(resumed.paymentId).toBe(String(again.id));
        expect(resumed.supersededPaymentIds).toEqual([String(first.id)]);

        // The payer completes the page opened first.
        await service.handleOrderWebhook({
          eventType: "Order",
          metadata: { bookingId: first.bookingId, competitionId },
          data: {
            id: 1,
            checkoutIntentId: first.id,
            payments: [{ amount: SEAT_PRICE_CENTS, state: "Authorized" }],
          },
        });
        const confirmed = await prisma.seatBooking.findUniqueOrThrow({
          where: { id: first.bookingId },
        });
        expect(confirmed.status).toBe("CONFIRMED");
        expect(confirmed.paymentId).toBe(String(first.id));
        expect(confirmed.supersededPaymentIds).toEqual([String(again.id)]);

        // ...and then the second page too: a refund is owed, the seat kept.
        await service.handleOrderWebhook({
          eventType: "Order",
          metadata: { bookingId: first.bookingId, competitionId },
          data: {
            id: 2,
            checkoutIntentId: again.id,
            payments: [{ amount: SEAT_PRICE_CENTS, state: "Authorized" }],
          },
        });
        const twice = await prisma.seatBooking.findUniqueOrThrow({
          where: { id: first.bookingId },
        });
        expect(twice.status).toBe("CONFIRMED");
        expect(twice.refundOwedAt).not.toBeNull();
        expect(twice.refundOwedPaymentIds).toEqual([String(again.id)]);
      });
    });

    it("flags a late payment as refund owed and alerts the organising club once", async () => {
      const notifications = moduleRef.get(NotificationsService);
      (notifications.sendToUsers as jest.Mock).mockClear();
      const booking = await checkout();
      await expire(booking.id);
      const late = order(booking.id, {
        amount: SEAT_PRICE_CENTS,
        state: "Authorized",
      });

      await service.handleOrderWebhook(late);
      await service.handleOrderWebhook(late); // HelloAsso redelivery

      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.status).toBe("EXPIRED");
      expect(after.refundOwedAt).not.toBeNull();
      expect(after.refundOwedPaymentIds).toEqual([after.paymentId]);
      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        [clubManagerId],
        "CLUB_PAYMENT_RECEIVED",
        "Remboursement à effectuer",
        expect.stringContaining("Remboursez-le"),
        expect.objectContaining({
          type: "club_payment_refund_owed",
          bookingId: booking.id,
        }),
      );
    });
  });

  describe("re-hold cooldown after an expired hold (#455)", () => {
    it("refuses (409) the same user re-holding a seat they let expire, not another user", async () => {
      const first = await checkout();
      await expire(first.id);

      await expect(checkout()).rejects.toThrow(ConflictException);
      expect(await statusOf(first.id)).toBe("EXPIRED");
      expect(createCheckoutIntent).toHaveBeenCalledTimes(1);

      await expect(
        service.createCheckout(otherUserId, {
          competitionId,
          itemId: "table-1",
        }),
      ).resolves.toBeDefined();
    });

    it("only concerns that seat: another seat of the element can be held", async () => {
      const first = await service.createCheckout(userId, {
        competitionId,
        itemId: "table-8",
        seatIndex: 2,
      });
      await expire(first.bookingId);

      await expect(
        service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 2,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.createCheckout(userId, {
          competitionId,
          itemId: "table-8",
          seatIndex: 3,
        }),
      ).resolves.toBeDefined();
    });

    it("lets « first free seat » skip the seat in cooldown instead of refusing", async () => {
      const first = await service.createCheckout(userId, {
        competitionId,
        itemId: "table-8",
      });
      expect(first.seatIndex).toBe(0);
      await expire(first.bookingId);

      const next = await service.createCheckout(userId, {
        competitionId,
        itemId: "table-8",
      });

      expect(next.resumed).toBe(false);
      expect(next.seatIndex).toBe(1);
    });

    it("never blocks a late payer (refund owed) from buying the seat again", async () => {
      const booking = await checkout();
      await expire(booking.id);
      await service.handleOrderWebhook(
        order(booking.id, { amount: SEAT_PRICE_CENTS, state: "Authorized" }),
      );

      await expect(checkout()).resolves.toBeDefined();
    });
  });

  describe("payment on an earlier intent of a released booking (#456)", () => {
    const CURRENT_INTENT = 9101;
    const EARLIER_INTENT = 9100;

    const releasedBooking = () =>
      prisma.seatBooking.create({
        data: {
          competitionId,
          userId,
          itemId: "table-8",
          seatIndex: 4,
          status: "CANCELLED",
          cancelReason: "HELLOASSO_REFUNDED",
          paymentId: String(CURRENT_INTENT),
          supersededPaymentIds: [String(EARLIER_INTENT)],
          expectedAmountCents: SEAT_PRICE_CENTS,
        },
      });

    const process = async (payload: WebhookPayloadDto) => {
      const verifier = moduleRef.get(HelloAssoNotificationService);
      const verified = await verifier.resolveOrderNotification(payload);
      if (verified) await service.handleOrderWebhook(verified);
    };

    it("flags it as refund owed, alerts the club once and never gives the seat back", async () => {
      const notifications = moduleRef.get(NotificationsService);
      (notifications.sendToUsers as jest.Mock).mockClear();
      const booking = await releasedBooking();
      getCheckoutIntent.mockResolvedValue({
        found: true,
        value: {
          id: EARLIER_INTENT,
          metadata: { bookingId: booking.id, competitionId },
          order: {
            id: 777,
            checkoutIntentId: EARLIER_INTENT,
            payments: [
              { id: 1, amount: SEAT_PRICE_CENTS, state: "Authorized" },
            ],
          },
        },
      });
      const notification: WebhookPayloadDto = {
        eventType: "Order",
        metadata: { bookingId: booking.id, competitionId },
        data: { id: 777, checkoutIntentId: EARLIER_INTENT },
      };

      await process(notification);
      await process(notification); // HelloAsso redelivery

      expect(getCheckoutIntent).toHaveBeenCalledWith(
        expect.objectContaining({ organizationSlug: "club" }),
        String(EARLIER_INTENT),
      );
      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.status).toBe("CANCELLED");
      expect(after.cancelReason).toBe("HELLOASSO_REFUNDED");
      expect(after.paymentId).toBe(String(CURRENT_INTENT));
      expect(after.refundOwedPaymentIds).toEqual([String(EARLIER_INTENT)]);
      expect(after.refundOwedAt).not.toBeNull();
      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        [clubManagerId],
        "CLUB_PAYMENT_RECEIVED",
        "Remboursement à effectuer",
        expect.stringContaining("Remboursez-le"),
        expect.objectContaining({
          type: "club_payment_refund_owed",
          bookingId: booking.id,
          orderId: "777",
        }),
      );
      expect(
        await prisma.seatBooking.count({
          where: {
            competitionId,
            itemId: "table-8",
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        }),
      ).toBe(0);
    });

    it("never re-reads the released seat's own (refunded) intent", async () => {
      const booking = await releasedBooking();

      await process({
        eventType: "Order",
        metadata: { bookingId: booking.id, competitionId },
        data: { id: 777, checkoutIntentId: CURRENT_INTENT },
      });

      expect(getCheckoutIntent).not.toHaveBeenCalled();
      const after = await prisma.seatBooking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(after.refundOwedPaymentIds).toEqual([]);
    });
  });
});
