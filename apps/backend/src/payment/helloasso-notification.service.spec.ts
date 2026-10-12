import { ServiceUnavailableException } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import type { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import type { HelloAssoService } from "./hello-asso.service";
import { HelloAssoNotificationService } from "./helloasso-notification.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

const BOOKING_ID = "3f1c2b6e-8a4d-4c1e-9b7a-2d5e6f708192";

describe("HelloAssoNotificationService (#404)", () => {
  const credentials = {
    clientId: "client",
    clientSecret: "secret",
    organizationSlug: "club",
  };
  const booking = {
    id: BOOKING_ID,
    competitionId: "comp-1",
    status: "PENDING",
    paymentId: "4242",
    expectedAmountCents: 1500,
    supersededPaymentIds: [] as string[],
    refundOwedPaymentIds: [] as string[],
  };
  /** What a real HelloAsso checkout intent looks like once paid. */
  const paidIntent = {
    id: 4242,
    redirectUrl: "https://checkout",
    metadata: { bookingId: BOOKING_ID, competitionId: "comp-1" },
    order: {
      id: 98765,
      checkoutIntentId: 4242,
      formType: "Checkout",
      organizationSlug: "club",
      payer: { email: "payer@example.com" },
      amount: { total: 1500, vat: 0, discount: 0 },
      payments: [
        {
          id: 555,
          amount: 1500,
          state: "Authorized",
          cashOutState: "MoneyIn",
          refundOperations: [],
        },
      ],
    },
  };
  /** The (untrusted) notification: claims whatever an attacker wants. */
  const notification: WebhookPayloadDto = {
    eventType: "Order",
    metadata: { bookingId: BOOKING_ID, competitionId: "comp-1" },
    data: {
      id: 1,
      checkoutIntentId: 1,
      payments: [{ amount: 999999, state: "Authorized" }],
    },
  };

  let findUnique: jest.Mock;
  let getCheckoutIntent: jest.Mock;
  let getCredentials: jest.Mock;
  let service: HelloAssoNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique = jest.fn().mockResolvedValue(booking);
    getCheckoutIntent = jest
      .fn()
      .mockResolvedValue({ found: true, value: paidIntent });
    getCredentials = jest.fn().mockResolvedValue(credentials);
    service = new HelloAssoNotificationService(
      { seatBooking: { findUnique } } as unknown as PrismaService,
      { getCheckoutIntent } as unknown as HelloAssoService,
      {
        getHelloAssoCredentialsForCompetition: getCredentials,
      } as unknown as ClubsHelloAssoService,
    );
  });

  const expectIgnoredQuietly = () =>
    expect(Sentry.captureMessage).not.toHaveBeenCalled();

  const expectIgnored = (reason: string) =>
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "HelloAsso notification ignored",
      expect.objectContaining({
        tags: { payment: "helloasso-notification-ignored", reason },
      }),
    );

  it("rebuilds the order from HelloAsso's API, never from the notification", async () => {
    const verified = await service.resolveOrderNotification(notification);

    expect(getCredentials).toHaveBeenCalledWith("comp-1");
    // The booking's own checkout intent, not the one the payload names.
    expect(getCheckoutIntent).toHaveBeenCalledWith(credentials, "4242");
    expect(verified).toMatchObject({
      eventType: "Order",
      metadata: { bookingId: BOOKING_ID, competitionId: "comp-1" },
      data: {
        id: 98765,
        checkoutIntentId: 4242,
        payments: [{ id: 555, amount: 1500, state: "Authorized" }],
      },
    });
    // Only the fields we read survive (no payer data carried along).
    expect(JSON.stringify(verified)).not.toContain("payer@example.com");
  });

  it("falls back to the intent id when the order omits checkoutIntentId", async () => {
    const { checkoutIntentId: _omitted, ...order } = paidIntent.order;
    getCheckoutIntent.mockResolvedValue({
      found: true,
      value: { ...paidIntent, order },
    });

    const verified = await service.resolveOrderNotification(notification);

    expect(verified?.data.checkoutIntentId).toBe(4242);
  });

  it("ignores a notification without booking reference (not ours), silently", async () => {
    const verified = await service.resolveOrderNotification({
      eventType: "Order",
      data: {},
    });

    expect(verified).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("ignores and traces an unknown booking", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnoredQuietly(); // booking_not_found: forgeable, no Sentry
    expect(getCheckoutIntent).not.toHaveBeenCalled();
  });

  it("ignores a booking that never got a checkout intent", async () => {
    findUnique.mockResolvedValue({ ...booking, paymentId: null });

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnoredQuietly(); // no_checkout_intent: forgeable, no Sentry
  });

  it("ignores when the organising club has no HelloAsso credentials", async () => {
    getCredentials.mockResolvedValue(null);

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnoredQuietly(); // club_not_connected: forgeable, no Sentry
  });

  it("ignores an intent HelloAsso does not know (404)", async () => {
    getCheckoutIntent.mockResolvedValue({ found: false });

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnored("intent_not_found");
  });

  it("ignores an intent whose metadata names another booking", async () => {
    getCheckoutIntent.mockResolvedValue({
      found: true,
      value: { ...paidIntent, metadata: { bookingId: "other" } },
    });

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnored("intent_mismatch");
  });

  it("ignores an intent without metadata", async () => {
    getCheckoutIntent.mockResolvedValue({
      found: true,
      value: { ...paidIntent, metadata: undefined },
    });

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnored("intent_mismatch");
  });

  it("ignores an order HelloAsso returns malformed (amount not cents)", async () => {
    getCheckoutIntent.mockResolvedValue({
      found: true,
      value: {
        ...paidIntent,
        order: {
          ...paidIntent.order,
          payments: [{ amount: "1500", state: "Authorized" }],
        },
      },
    });

    await expect(
      service.resolveOrderNotification(notification),
    ).resolves.toBeNull();
    expectIgnored("invalid_intent");
  });

  it("asks for a redelivery (503) while the payment is not authorized yet", async () => {
    getCheckoutIntent.mockResolvedValue({
      found: true,
      value: { ...paidIntent, order: undefined },
    });

    await expect(
      service.resolveOrderNotification(notification),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("asks for a redelivery (503) when HelloAsso is unreachable", async () => {
    getCheckoutIntent.mockRejectedValue(new Error("circuit open"));

    await expect(
      service.resolveOrderNotification(notification),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("reads the legacy data.metadata location of the booking reference", async () => {
    await service.resolveOrderNotification({
      eventType: "Order",
      data: { metadata: { bookingId: BOOKING_ID } },
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOOKING_ID } }),
    );
  });
  it("ignores silently a bookingId that is not one of our UUIDs", async () => {
    const verified = await service.resolveOrderNotification({
      eventType: "Order",
      metadata: { bookingId: "line\ninjection" },
      data: {},
    });

    expect(verified).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it.each(["CONFIRMED", "CANCELLED"])(
    "never calls HelloAsso for a %s booking (replays cannot amplify)",
    async (status) => {
      findUnique.mockResolvedValue({ ...booking, status });

      await expect(
        service.resolveOrderNotification(notification),
      ).resolves.toBeNull();
      expect(getCheckoutIntent).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    },
  );

  it("still re-reads an EXPIRED hold: a late payment must be detected (#401)", async () => {
    findUnique.mockResolvedValue({ ...booking, status: "EXPIRED" });

    await service.resolveOrderNotification(notification);

    expect(getCheckoutIntent).toHaveBeenCalled();
  });
  describe("resumed payments (#428)", () => {
    const resumed = {
      ...booking,
      paymentId: "5000",
      supersededPaymentIds: ["4242"],
    };
    const naming = (checkoutIntentId: number): WebhookPayloadDto => ({
      ...notification,
      data: { ...notification.data, checkoutIntentId },
    });

    it("re-reads an earlier intent of the booking that the notification names", async () => {
      findUnique.mockResolvedValue(resumed);

      const verified = await service.resolveOrderNotification(naming(4242));

      expect(getCheckoutIntent).toHaveBeenCalledWith(credentials, "4242");
      expect(verified?.data.checkoutIntentId).toBe(4242);
    });

    it("re-reads the current intent when the named one is not the booking's", async () => {
      findUnique.mockResolvedValue(resumed);

      await service.resolveOrderNotification(naming(777));

      expect(getCheckoutIntent).toHaveBeenCalledWith(credentials, "5000");
    });

    it("re-reads an earlier intent of a CONFIRMED booking (second payment)", async () => {
      findUnique.mockResolvedValue({ ...resumed, status: "CONFIRMED" });

      const verified = await service.resolveOrderNotification(naming(4242));

      expect(getCheckoutIntent).toHaveBeenCalledWith(credentials, "4242");
      expect(verified).not.toBeNull();
    });

    it("never re-reads a CONFIRMED booking's current intent", async () => {
      findUnique.mockResolvedValue({ ...resumed, status: "CONFIRMED" });

      await expect(
        service.resolveOrderNotification(naming(5000)),
      ).resolves.toBeNull();
      expect(getCheckoutIntent).not.toHaveBeenCalled();
    });
  });
});
