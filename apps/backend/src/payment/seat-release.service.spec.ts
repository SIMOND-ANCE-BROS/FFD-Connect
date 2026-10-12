import { ServiceUnavailableException } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import type { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import type { HelloAssoService } from "./hello-asso.service";
import {
  SEAT_RELEASE_REASONS,
  SeatReleaseService,
} from "./seat-release.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

const BOOKING_ID = "3f1c2b6e-8a4d-4c1e-9b7a-2d5e6f708192";

describe("SeatReleaseService (#403)", () => {
  const credentials = {
    clientId: "client",
    clientSecret: "secret",
    organizationSlug: "club",
  };
  const confirmed = {
    id: BOOKING_ID,
    competitionId: "comp-1",
    status: "CONFIRMED",
    paymentId: "4242",
    expectedAmountCents: 1500,
    supersededPaymentIds: [] as string[],
    refundOwedPaymentIds: [] as string[],
  };
  const refundNotification: WebhookPayloadDto = {
    eventType: "Payment",
    metadata: { bookingId: BOOKING_ID, competitionId: "comp-1" },
    data: { id: 555, state: "Refunded" },
  };
  const payment = (state: string, order: Record<string, unknown>) => ({
    found: true,
    value: { id: 555, amount: 1500, state, order },
  });

  let findUnique: jest.Mock;
  let updateMany: jest.Mock;
  let getPayment: jest.Mock;
  let getOrder: jest.Mock;
  let getCredentials: jest.Mock;
  let service: SeatReleaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique = jest.fn().mockResolvedValue(confirmed);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    getPayment = jest
      .fn()
      .mockResolvedValue(
        payment("Refunded", { id: 98765, checkoutIntentId: 4242 }),
      );
    getOrder = jest.fn();
    getCredentials = jest.fn().mockResolvedValue(credentials);
    service = new SeatReleaseService(
      { seatBooking: { findUnique, updateMany } } as unknown as PrismaService,
      { getPayment, getOrder } as unknown as HelloAssoService,
      {
        getHelloAssoCredentialsForCompetition: getCredentials,
      } as unknown as ClubsHelloAssoService,
    );
  });

  it("documents the HelloAsso states that release a seat", () => {
    expect([...SEAT_RELEASE_REASONS.keys()]).toEqual(["Refunded", "Contested"]);
  });

  it.each([
    ["Refunded", "HELLOASSO_REFUNDED"],
    ["Contested", "HELLOASSO_CONTESTED"],
  ])(
    "releases a confirmed seat when HelloAsso says %s",
    async (state, reason) => {
      getPayment.mockResolvedValue(
        payment(state, { id: 98765, checkoutIntentId: 4242 }),
      );

      await service.handlePaymentNotification({
        ...refundNotification,
        data: { id: 555, state },
      });

      expect(getPayment).toHaveBeenCalledWith(credentials, "555");
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: BOOKING_ID, status: "CONFIRMED" },
        data: { status: "CANCELLED", cancelReason: reason },
      });
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "HelloAsso seat released",
        expect.objectContaining({
          tags: { payment: "helloasso-seat-released", reason },
          extra: { bookingId: BOOKING_ID, paymentId: 555 },
        }),
      );
    },
  );

  it("does not report a release twice (idempotent conditional write)", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await service.handlePaymentNotification(refundNotification);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it.each(["Authorized", "Refunding", "Pending", undefined])(
    "skips a notification claiming %p without any read",
    async (state) => {
      await service.handlePaymentNotification({
        ...refundNotification,
        data: { id: 555, state },
      });

      expect(findUnique).not.toHaveBeenCalled();
      expect(getPayment).not.toHaveBeenCalled();
    },
  );

  it("skips a booking reference that is not a UUID", async () => {
    await service.handlePaymentNotification({
      ...refundNotification,
      metadata: { bookingId: "not-a-uuid" },
    });

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("skips a notification without payment id", async () => {
    await service.handlePaymentNotification({
      ...refundNotification,
      data: { state: "Refunded" },
    });

    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ignores an unknown booking without calling HelloAsso nor Sentry", async () => {
    findUnique.mockResolvedValue(null);

    await service.handlePaymentNotification(refundNotification);

    expect(getPayment).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("asks for a redelivery (503) while the booking is still PENDING", async () => {
    findUnique.mockResolvedValue({ ...confirmed, status: "PENDING" });

    await expect(
      service.handlePaymentNotification(refundNotification),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(getPayment).not.toHaveBeenCalled();
  });

  it.each(["EXPIRED", "CANCELLED"])(
    "never touches a %s booking",
    async (status) => {
      findUnique.mockResolvedValue({ ...confirmed, status });

      await service.handlePaymentNotification(refundNotification);

      expect(getPayment).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it("ignores when the organising club has no HelloAsso credentials", async () => {
    getCredentials.mockResolvedValue(null);

    await service.handlePaymentNotification(refundNotification);

    expect(getPayment).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps the seat when HelloAsso still reports the payment as Authorized (forged refund)", async () => {
    getPayment.mockResolvedValue(
      payment("Authorized", { id: 98765, checkoutIntentId: 4242 }),
    );

    await service.handlePaymentNotification(refundNotification);

    expect(updateMany).not.toHaveBeenCalled();
  });

  const expectRejectedQuietly = () => {
    expect(updateMany).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  };

  const expectRejected = (reason: string) => {
    expect(updateMany).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "HelloAsso payment notification rejected",
      expect.objectContaining({
        tags: { payment: "helloasso-payment-rejected", reason },
      }),
    );
  };

  it("rejects a payment HelloAsso does not know", async () => {
    getPayment.mockResolvedValue({ found: false });

    await service.handlePaymentNotification(refundNotification);

    expectRejectedQuietly(); // forgeable: another payment id
  });

  it.each([
    ["no state", { id: 555, order: { id: 98765 } }],
    ["no order", { id: 555, state: "Refunded" }],
    ["bad order id", { id: 555, state: "Refunded", order: { id: "x" } }],
  ])("rejects a malformed payment (%s)", async (_label, value) => {
    getPayment.mockResolvedValue({ found: true, value });

    await service.handlePaymentNotification(refundNotification);

    expectRejected("invalid_payment");
  });

  it("rejects a refund of another checkout's payment", async () => {
    getPayment.mockResolvedValue(
      payment("Refunded", { id: 98765, checkoutIntentId: 9999 }),
    );

    await service.handlePaymentNotification(refundNotification);

    expectRejectedQuietly(); // forgeable: another payment of the org
  });

  it("reads the checkout intent from the order when the payment omits it", async () => {
    getPayment.mockResolvedValue(payment("Refunded", { id: 98765 }));
    getOrder.mockResolvedValue({
      found: true,
      value: { id: 98765, checkoutIntentId: 4242 },
    });

    await service.handlePaymentNotification(refundNotification);

    expect(getOrder).toHaveBeenCalledWith(credentials, "98765");
    expect(updateMany).toHaveBeenCalled();
  });

  it.each([
    ["unknown order", { found: false }],
    ["order without checkout intent", { found: true, value: { id: 98765 } }],
  ])(
    "rejects when the checkout intent cannot be established (%s)",
    async (_l, read) => {
      getPayment.mockResolvedValue(payment("Refunded", { id: 98765 }));
      getOrder.mockResolvedValue(read);

      await service.handlePaymentNotification(refundNotification);

      expectRejected("order_not_found");
    },
  );

  it("answers 503 when HelloAsso is unreachable (redelivery)", async () => {
    getPayment.mockRejectedValue(new Error("circuit open"));

    await expect(
      service.handlePaymentNotification(refundNotification),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("answers 503 when the order re-read fails", async () => {
    getPayment.mockResolvedValue(payment("Refunded", { id: 98765 }));
    getOrder.mockRejectedValue(new Error("timeout"));

    await expect(
      service.handlePaymentNotification(refundNotification),
    ).rejects.toThrow(ServiceUnavailableException);
  });
  describe("refund owed (#428)", () => {
    const refundOwedPaymentIds = ["4242"];

    it.each([
      ["Refunded", "HELLOASSO_REFUNDED"],
      ["Contested", "HELLOASSO_CONTESTED"],
    ])(
      "settles the refund owed on an EXPIRED booking when HelloAsso says %s",
      async (state, reason) => {
        findUnique.mockResolvedValue({
          ...confirmed,
          status: "EXPIRED",
          refundOwedPaymentIds,
        });
        getPayment.mockResolvedValue(
          payment(state, { id: 98765, checkoutIntentId: 4242 }),
        );

        await service.handlePaymentNotification({
          ...refundNotification,
          data: { id: 555, state },
        });

        expect(updateMany).toHaveBeenCalledTimes(1);
        expect(updateMany).toHaveBeenCalledWith({
          where: {
            id: BOOKING_ID,
            refundOwedPaymentIds: { equals: ["4242"] },
          },
          data: {
            refundOwedPaymentIds: { set: [] },
            refundOwedAt: null,
            cancelReason: reason,
          },
        });
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          "HelloAsso refund owed settled",
          expect.objectContaining({
            tags: { payment: "helloasso-refund-settled", reason },
          }),
        );
      },
    );

    it("keeps a confirmed seat when the refunded payment is its duplicate", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        paymentId: "5000",
        supersededPaymentIds: ["4242"],
        refundOwedPaymentIds,
      });

      await service.handlePaymentNotification(refundNotification);

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: BOOKING_ID,
          refundOwedPaymentIds: { equals: ["4242"] },
        },
        data: { refundOwedPaymentIds: { set: [] }, refundOwedAt: null },
      });
    });

    it("ignores the refund of an earlier intent when no refund was owed", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        paymentId: "5000",
        supersededPaymentIds: ["4242"],
      });

      await service.handlePaymentNotification(refundNotification);

      expect(updateMany).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("keeps the other refunds owed and their marker", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        status: "EXPIRED",
        supersededPaymentIds: ["4300"],
        refundOwedPaymentIds: ["4300", "4242"],
      });

      await service.handlePaymentNotification(refundNotification);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: BOOKING_ID,
          refundOwedPaymentIds: { equals: ["4300", "4242"] },
        },
        data: {
          refundOwedPaymentIds: { set: ["4300"] },
          cancelReason: "HELLOASSO_REFUNDED",
        },
      });
    });

    it("ignores the refund of a payment that was not owed back", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        status: "EXPIRED",
        supersededPaymentIds: ["4300"],
        refundOwedPaymentIds: ["4300"],
      });

      await service.handlePaymentNotification(refundNotification);

      expect(updateMany).not.toHaveBeenCalled();
    });

    it("asks for a redelivery when the refunds owed changed meanwhile", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        status: "EXPIRED",
        refundOwedPaymentIds,
      });
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.handlePaymentNotification(refundNotification),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("still rejects a payment of an intent that is not the booking's", async () => {
      findUnique.mockResolvedValue({
        ...confirmed,
        status: "EXPIRED",
        refundOwedPaymentIds,
      });
      getPayment.mockResolvedValue(
        payment("Refunded", { id: 98765, checkoutIntentId: 1 }),
      );

      await service.handlePaymentNotification(refundNotification);

      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
