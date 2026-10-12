import {
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentNotificationService } from "./payment-notification.service";
import { seatBookingPaymentCheckSelect } from "../utils/prisma-selects";
import type { CreateCheckoutDto } from "./dto/create-checkout.dto";
import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { HelloAssoService } from "./hello-asso.service";
import {
  CHECKOUT_REDIRECT_REUSE_MS,
  MAX_INTENTS_PER_BOOKING,
  PaymentService,
} from "./payment.service";
import { RefundOwedAlertService } from "./refund-owed-alert.service";
import { SeatHoldService, type HeldBooking } from "./seat-hold.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

describe("PaymentService", () => {
  let service: PaymentService;
  let prisma: DeepMockProxy<PrismaClient>;
  let helloAssoService: jest.Mocked<
    Pick<HelloAssoService, "createCheckoutIntent" | "getCheckoutIntent">
  >;
  let clubsService: jest.Mocked<
    Pick<ClubsHelloAssoService, "getHelloAssoCredentialsForCompetition">
  >;
  let configService: jest.Mocked<Pick<ConfigService, "get">>;
  let paymentNotificationService: jest.Mocked<
    Pick<PaymentNotificationService, "notifyPaymentReceived">
  >;
  let seatHold: jest.Mocked<
    Pick<SeatHoldService, "hold" | "recordIntent" | "replaceIntent" | "release">
  >;
  let refundOwedAlert: jest.Mocked<Pick<RefundOwedAlertService, "alertClub">>;

  const mockCredentials = {
    clientId: "client-id",
    clientSecret: "client-secret",
    organizationSlug: "org-slug",
  };

  const mockUser = {
    id: "user-1",
    email: "user@example.com",
    firstName: "John",
    lastName: "Doe",
  };

  const SEAT_PRICE_CENTS = 1500;
  const mockCompetition = {
    id: "comp-1",
    layout: [
      { id: "other-item", priceCents: 9900 },
      {
        id: "item-1",
        type: "TABLE",
        label: "Table 1",
        capacity: 8,
        lockedSeats: [7],
        priceCents: SEAT_PRICE_CENTS,
      },
      { id: "free-1", type: "OTHER", capacity: 20, priceCents: 800 },
    ],
  };

  const mockDto: CreateCheckoutDto = {
    competitionId: "comp-1",
    itemId: "item-1",
    seatIndex: 3,
    seatLabel: "A1",
    // Tampered amount sent by the client: must be ignored (#381).
    amount: 1,
  };

  const holdExpiresAt = new Date(Date.now() + 50 * 60 * 1000);
  const heldBooking = (overrides: Partial<HeldBooking> = {}): HeldBooking => ({
    id: "booking-1",
    seatIndex: 3,
    expiresAt: holdExpiresAt,
    createdAt: new Date(),
    expectedAmountCents: SEAT_PRICE_CENTS,
    paymentId: null,
    checkoutRedirectUrl: null,
    checkoutCreatedAt: null,
    supersededPaymentIds: [],
    ...overrides,
  });

  const intent = { id: 4242, redirectUrl: "https://helloasso.com/pay/4242" };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    helloAssoService = {
      createCheckoutIntent: jest.fn(),
      getCheckoutIntent: jest.fn(),
    };
    clubsService = { getHelloAssoCredentialsForCompetition: jest.fn() };
    configService = {
      get: jest.fn().mockReturnValue("https://app.example.com"),
    };
    seatHold = {
      hold: jest.fn(),
      recordIntent: jest.fn().mockResolvedValue(undefined),
      replaceIntent: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    refundOwedAlert = { alertClub: jest.fn().mockResolvedValue(undefined) };

    paymentNotificationService = {
      notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: HelloAssoService, useValue: helloAssoService },
        { provide: ClubsHelloAssoService, useValue: clubsService },
        { provide: ConfigService, useValue: configService },
        {
          provide: PaymentNotificationService,
          useValue: paymentNotificationService,
        },
        { provide: SeatHoldService, useValue: seatHold },
        { provide: RefundOwedAlertService, useValue: refundOwedAlert },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);
  });

  describe("createCheckout", () => {
    beforeEach(() => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      seatHold.hold.mockResolvedValue({
        resumed: false,
        booking: heldBooking(),
      });
      helloAssoService.createCheckoutIntent.mockResolvedValue(intent);
    });

    it("refuses when the organising club has not connected HelloAsso", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        null,
      );

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /HelloAsso/,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(seatHold.hold).not.toHaveBeenCalled();
    });

    it("refuses when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "User not found",
      );
      expect(seatHold.hold).not.toHaveBeenCalled();
    });

    it.each([
      ["the competition does not exist", null],
      ["the layout is empty", { id: "comp-1", layout: [] }],
      ["the layout is not an array", { id: "comp-1", layout: null }],
      [
        "the item has no price",
        { id: "comp-1", layout: [{ id: "item-1", label: "Table 1" }] },
      ],
      [
        "the item price is zero",
        { id: "comp-1", layout: [{ id: "item-1", priceCents: 0 }] },
      ],
      [
        "the item price is not an integer",
        { id: "comp-1", layout: [{ id: "item-1", priceCents: 10.5 }] },
      ],
      [
        "the item price is a string",
        { id: "comp-1", layout: [{ id: "item-1", priceCents: "1500" }] },
      ],
      [
        "the item price is absurdly high",
        { id: "comp-1", layout: [{ id: "item-1", priceCents: 1_000_001 }] },
      ],
      [
        "the item is not in the layout",
        { id: "comp-1", layout: [{ id: "other", priceCents: 1500 }, "junk"] },
      ],
    ])("refuses the checkout when %s", async (_label, competition) => {
      prisma.competition.findUnique.mockResolvedValue(competition as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /Aucun tarif/,
      );
      expect(seatHold.hold).not.toHaveBeenCalled();
      expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
    });

    it("refuses a priced element without any bookable seat", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        layout: [{ id: "item-1", type: "TABLE", capacity: 0, priceCents: 1 }],
      } as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(seatHold.hold).not.toHaveBeenCalled();
    });

    it("holds the requested seat of the element at the layout price", async () => {
      await service.createCheckout("user-1", mockDto);

      expect(prisma.competition.findUnique).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        select: { id: true, layout: true },
      });
      expect(seatHold.hold).toHaveBeenCalledWith({
        userId: "user-1",
        competitionId: "comp-1",
        itemId: "item-1",
        seats: { mode: "numbered", seats: 8, locked: new Set([7]) },
        seatIndex: 3,
        seatLabel: "A1",
        amountCents: SEAT_PRICE_CENTS,
      });
    });

    it("creates the HelloAsso intent with the server price, never the client's", async () => {
      await service.createCheckout("user-1", mockDto);

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        "https://app.example.com",
        {
          amount: SEAT_PRICE_CENTS,
          label: "Place Compétition - A1",
          consumerEmail: mockUser.email,
          consumerFirstName: mockUser.firstName,
          consumerLastName: mockUser.lastName,
          metadata: { bookingId: "booking-1", competitionId: "comp-1" },
        },
      );
    });

    it("falls back to the item id in the label and to a default APP_URL", async () => {
      configService.get.mockReturnValue(undefined);

      await service.createCheckout("user-1", {
        competitionId: "comp-1",
        itemId: "item-1",
      });

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        "https://app.example.com",
        expect.objectContaining({ label: "Place Compétition - item-1" }),
      );
    });

    it("records the intent (id as a string, redirect, creation time) and returns the seat", async () => {
      const result = await service.createCheckout("user-1", mockDto);

      expect(seatHold.recordIntent).toHaveBeenCalledWith(
        "booking-1",
        { id: "4242", redirectUrl: intent.redirectUrl },
        expect.any(Date),
      );
      expect(result).toEqual({
        id: 4242,
        redirectUrl: intent.redirectUrl,
        bookingId: "booking-1",
        seatIndex: 3,
        expiresAt: holdExpiresAt,
        resumed: false,
      });
    });

    it("never exposes the internal place slot of a free-placement element", async () => {
      seatHold.hold.mockResolvedValue({
        resumed: false,
        booking: heldBooking({ seatIndex: 5 }),
      });

      const result = await service.createCheckout("user-1", {
        competitionId: "comp-1",
        itemId: "free-1",
      });

      expect(seatHold.hold).toHaveBeenCalledWith(
        expect.objectContaining({
          seats: { mode: "free", places: 20 },
          amountCents: 800,
        }),
      );
      expect(result.seatIndex).toBeNull();
    });

    it("propagates the hold's refusal (409) without any HelloAsso intent", async () => {
      seatHold.hold.mockRejectedValue(new ConflictException("taken"));

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        ConflictException,
      );
      expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
    });

    it.each([
      ["the HelloAsso intent fails", "intent"],
      ["recording the intent fails", "record"],
    ])("releases the seat when %s", async (_label, failing) => {
      if (failing === "intent") {
        helloAssoService.createCheckoutIntent.mockRejectedValue(
          new Error("HelloAsso down"),
        );
      } else {
        seatHold.recordIntent.mockRejectedValue("db down");
      }
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "Échec de l'initiation du paiement",
      );
      expect(seatHold.release).toHaveBeenCalledWith("booking-1");
    });

    describe("resume of the user's own pending seat (#428)", () => {
      const now = Date.now();
      const resume = (overrides: Partial<HeldBooking>) =>
        seatHold.hold.mockResolvedValue({
          resumed: true,
          booking: heldBooking({
            paymentId: "4000",
            checkoutRedirectUrl: "https://helloasso.com/pay/4000",
            checkoutCreatedAt: new Date(now - 60_000),
            ...overrides,
          }),
        });

      it("returns the stored HelloAsso page while it is still valid", async () => {
        resume({});

        const result = await service.createCheckout("user-1", mockDto);

        expect(result).toEqual({
          id: 4000,
          redirectUrl: "https://helloasso.com/pay/4000",
          bookingId: "booking-1",
          seatIndex: 3,
          expiresAt: holdExpiresAt,
          resumed: true,
        });
        expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
        expect(helloAssoService.getCheckoutIntent).not.toHaveBeenCalled();
      });

      it("creates a fresh intent at the booking's price once the page has expired", async () => {
        resume({
          checkoutCreatedAt: new Date(now - CHECKOUT_REDIRECT_REUSE_MS - 1),
          expectedAmountCents: 1200,
        });
        helloAssoService.getCheckoutIntent.mockResolvedValue({
          found: true,
          value: { id: 4000 },
        });
        const extended = new Date(now + 60 * 60 * 1000);
        seatHold.replaceIntent.mockResolvedValue({
          replaced: true,
          expiresAt: extended,
        });

        const result = await service.createCheckout("user-1", mockDto);

        expect(helloAssoService.getCheckoutIntent).toHaveBeenCalledWith(
          mockCredentials,
          "4000",
        );
        expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
          mockCredentials,
          expect.any(String),
          expect.objectContaining({
            amount: 1200,
            metadata: { bookingId: "booking-1", competitionId: "comp-1" },
          }),
        );
        expect(seatHold.replaceIntent).toHaveBeenCalledWith(
          expect.objectContaining({ id: "booking-1", paymentId: "4000" }),
          { id: "4242", redirectUrl: intent.redirectUrl },
          expect.any(Date),
        );
        expect(result).toEqual(
          expect.objectContaining({
            id: 4242,
            expiresAt: extended,
            resumed: true,
          }),
        );
        expect(seatHold.release).not.toHaveBeenCalled();
      });

      it("creates a fresh intent when no page was stored (booking from before #428)", async () => {
        resume({ checkoutRedirectUrl: null, checkoutCreatedAt: null });
        helloAssoService.getCheckoutIntent.mockResolvedValue({ found: false });
        seatHold.replaceIntent.mockResolvedValue({
          replaced: true,
          expiresAt: holdExpiresAt,
        });

        await expect(
          service.createCheckout("user-1", mockDto),
        ).resolves.toEqual(expect.objectContaining({ id: 4242 }));
      });

      it.each([
        ["no intent was created yet", { paymentId: null }],
        ["the booking has no stored price", { expectedAmountCents: null }],
      ])("answers 409 when %s", async (_label, overrides) => {
        resume({ checkoutCreatedAt: null, ...overrides });

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          ConflictException,
        );
        expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
      });

      it("answers 409 after too many payment attempts", async () => {
        resume({
          checkoutCreatedAt: null,
          supersededPaymentIds: Array.from(
            { length: MAX_INTENTS_PER_BOOKING - 1 },
            (_, i) => String(i + 1),
          ),
        });

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          /Trop de tentatives/,
        );
        expect(helloAssoService.getCheckoutIntent).not.toHaveBeenCalled();
      });

      it("never replaces an intent HelloAsso already has a payment for", async () => {
        resume({ checkoutCreatedAt: null });
        helloAssoService.getCheckoutIntent.mockResolvedValue({
          found: true,
          value: { id: 4000, order: { id: 1 } },
        });

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          /paiement est déjà en cours/,
        );
        expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
      });

      it("answers 503 when HelloAsso cannot be read", async () => {
        resume({ checkoutCreatedAt: null });
        helloAssoService.getCheckoutIntent.mockRejectedValue(
          new Error("timeout"),
        );

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          ServiceUnavailableException,
        );
      });

      it("keeps the hold when the fresh intent cannot be created", async () => {
        resume({ checkoutCreatedAt: null });
        helloAssoService.getCheckoutIntent.mockResolvedValue({ found: false });
        helloAssoService.createCheckoutIntent.mockRejectedValue(
          new Error("down"),
        );
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          BadRequestException,
        );
        expect(seatHold.release).not.toHaveBeenCalled();
        expect(seatHold.replaceIntent).not.toHaveBeenCalled();
      });

      it("never hands out the fresh intent when the booking changed meanwhile", async () => {
        resume({ checkoutCreatedAt: null });
        helloAssoService.getCheckoutIntent.mockResolvedValue({ found: false });
        seatHold.replaceIntent.mockResolvedValue({
          replaced: false,
          expiresAt: holdExpiresAt,
        });

        await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
          ConflictException,
        );
      });
    });
  });

  describe("handleOrderWebhook (#381)", () => {
    const bookingForCheck = {
      id: "booking-1",
      competitionId: "comp-1",
      status: "PENDING",
      paymentId: "4242",
      expectedAmountCents: 1500,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      supersededPaymentIds: [] as string[],
      refundOwedPaymentIds: [] as string[],
    };

    const paidOrder = (
      overrides: Partial<WebhookPayloadDto["data"]> = {},
      rootMetadata: WebhookPayloadDto["metadata"] = {
        bookingId: "booking-1",
        competitionId: "comp-1",
      },
    ): WebhookPayloadDto => ({
      eventType: "Order",
      metadata: rootMetadata,
      data: {
        id: 98765,
        checkoutIntentId: 4242,
        payments: [{ id: 1, amount: 1500, state: "Authorized" }],
        ...overrides,
      },
    });

    const confirmCall = {
      where: {
        id: "booking-1",
        status: "PENDING",
        paymentId: "4242",
        expectedAmountCents: 1500,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: "CONFIRMED",
        paymentId: "4242",
        supersededPaymentIds: [],
      },
    };

    beforeEach(() => {
      prisma.seatBooking.findUnique.mockResolvedValue(bookingForCheck as any);
      prisma.seatBooking.updateMany.mockResolvedValue({ count: 1 });
      (Sentry.captureMessage as jest.Mock).mockClear();
    });

    const expectRejected = (reason: string) => {
      expect(prisma.seatBooking.updateMany).not.toHaveBeenCalled();
      expect(prisma.seatBooking.update).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "HelloAsso order rejected",
        expect.objectContaining({
          level: "error",
          tags: expect.objectContaining({ reason }),
          extra: expect.objectContaining({ bookingId: "booking-1" }),
        }),
      );
    };

    it("confirms a paid order of the expected amount (happy path)", async () => {
      await service.handleOrderWebhook(paidOrder());

      expect(prisma.seatBooking.findUnique).toHaveBeenCalledWith({
        where: { id: "booking-1" },
        select: seatBookingPaymentCheckSelect,
      });
      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(confirmCall);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("accepts the legacy data.metadata location", async () => {
      await service.handleOrderWebhook({
        eventType: "Order",
        data: {
          checkoutIntentId: 4242,
          metadata: { bookingId: "booking-1", competitionId: "comp-1" },
          payments: [{ amount: 1500, state: "Authorized" }],
        },
      });

      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(confirmCall);
    });

    it("sums several paid payments and ignores unpaid ones", async () => {
      await service.handleOrderWebhook(
        paidOrder({
          payments: [
            { amount: 1000, state: "Authorized" },
            { amount: 700, state: "Refused" },
            { amount: 500, state: "Authorized" },
          ],
        }),
      );

      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(confirmCall);
    });

    it("ignores orders that carry no bookingId", async () => {
      await service.handleOrderWebhook(paidOrder({}, { competitionId: "x" }));
      await service.handleOrderWebhook({ eventType: "Order", data: {} });

      expect(prisma.seatBooking.findUnique).not.toHaveBeenCalled();
      expect(prisma.seatBooking.updateMany).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("does nothing (and does not alert) for an already confirmed booking", async () => {
      prisma.seatBooking.findUnique.mockResolvedValue({
        ...bookingForCheck,
        status: "CONFIRMED",
      } as any);

      await service.handleOrderWebhook(paidOrder());

      expect(prisma.seatBooking.updateMany).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("rejects an order whose booking does not exist", async () => {
      prisma.seatBooking.findUnique.mockResolvedValue(null);

      await service.handleOrderWebhook(paidOrder());

      expectRejected("booking_not_found");
    });

    it.each(["CANCELLED", "SOMETHING_NEW"])(
      "rejects an order for a %s booking (only PENDING transitions)",
      async (status) => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          status,
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expectRejected("not_pending");
      },
    );

    it("rejects when the booking changed between the read and the write", async () => {
      prisma.seatBooking.findUnique
        .mockResolvedValueOnce(bookingForCheck as any)
        .mockResolvedValueOnce({
          ...bookingForCheck,
          status: "CANCELLED",
        } as any);
      prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

      await service.handleOrderWebhook(paidOrder());

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "HelloAsso order rejected",
        expect.objectContaining({
          tags: expect.objectContaining({ reason: "not_pending" }),
        }),
      );
    });

    describe("organizer club notification (#39)", () => {
      it("notifies the organizer club once the booking is confirmed", async () => {
        await service.handleOrderWebhook(paidOrder());

        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).toHaveBeenCalledTimes(1);
        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).toHaveBeenCalledWith("booking-1");
        expect(
          prisma.seatBooking.updateMany.mock.invocationCallOrder[0],
        ).toBeLessThan(
          paymentNotificationService.notifyPaymentReceived.mock
            .invocationCallOrder[0],
        );
      });

      it("does not notify again on a redelivery of a confirmed booking", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          status: "CONFIRMED",
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).not.toHaveBeenCalled();
      });

      it("notifies only the delivery that wins the PENDING -> CONFIRMED transition", async () => {
        // Two concurrent deliveries both read the PENDING booking; the loser's
        // re-read then sees the seat the winner confirmed.
        prisma.seatBooking.findUnique
          .mockResolvedValueOnce(bookingForCheck as any)
          .mockResolvedValueOnce(bookingForCheck as any)
          .mockResolvedValueOnce({
            ...bookingForCheck,
            status: "CONFIRMED",
          } as any);
        prisma.seatBooking.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });

        await service.handleOrderWebhook(paidOrder());
        await service.handleOrderWebhook(paidOrder());

        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).toHaveBeenCalledTimes(1);
      });

      it("never notifies for a rejected order", async () => {
        await service.handleOrderWebhook(
          paidOrder({ payments: [{ amount: 1, state: "Authorized" }] }),
        );
        prisma.seatBooking.findUnique.mockResolvedValue(null);
        await service.handleOrderWebhook(paidOrder());

        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).not.toHaveBeenCalled();
      });

      it("does not notify when the database write fails", async () => {
        prisma.seatBooking.updateMany.mockRejectedValue(new Error("DB down"));

        await expect(service.handleOrderWebhook(paidOrder())).rejects.toThrow(
          "DB down",
        );
        expect(
          paymentNotificationService.notifyPaymentReceived,
        ).not.toHaveBeenCalled();
      });
    });

    it("rejects an unpaid order (refused payment)", async () => {
      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 1500, state: "Refused" }] }),
      );

      expectRejected("not_paid");
    });

    it.each(["Pending", "Refunded", "Unknown", "Processed", "authorized", ""])(
      "rejects a payment in a non allow-listed state (%p)",
      async (state) => {
        await service.handleOrderWebhook(
          paidOrder({ payments: [{ amount: 1500, state }] }),
        );

        expectRejected("not_paid");
      },
    );

    it("rejects an order without any payment", async () => {
      await service.handleOrderWebhook(paidOrder({ payments: undefined }));

      expectRejected("not_paid");
    });

    it.each([
      ["a missing amount", { state: "Authorized" }],
      ["a decimal (euros) amount", { amount: 15.0001, state: "Authorized" }],
      ["a negative amount", { amount: -1500, state: "Authorized" }],
      ["a string amount", { amount: "1500", state: "Authorized" }],
      ["a missing state", { amount: 1500 }],
    ])("rejects a payment with %s", async (_label, payment) => {
      await service.handleOrderWebhook(
        paidOrder({
          payments: [payment as unknown as { amount: number; state: string }],
        }),
      );

      expectRejected("invalid_payment");
    });

    it("rejects an amount in euros instead of cents", async () => {
      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 15, state: "Authorized" }] }),
      );

      expectRejected("amount_mismatch");
    });

    it("rejects an order paid with a tampered (lower) amount", async () => {
      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 1, state: "Authorized" }] }),
      );

      expectRejected("amount_mismatch");
    });

    it("rejects an order paid with a higher amount", async () => {
      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 1501, state: "Authorized" }] }),
      );

      expectRejected("amount_mismatch");
    });

    it("rejects an order for another competition", async () => {
      await service.handleOrderWebhook(
        paidOrder(
          {},
          { bookingId: "booking-1", competitionId: "another-competition" },
        ),
      );

      expectRejected("competition_mismatch");
    });

    it("rejects an order whose metadata has no competitionId", async () => {
      await service.handleOrderWebhook(
        paidOrder({}, { bookingId: "booking-1" }),
      );

      expectRejected("competition_mismatch");
    });

    it("rejects an order from another checkout intent", async () => {
      await service.handleOrderWebhook(paidOrder({ checkoutIntentId: 1 }));

      expectRejected("checkout_intent_mismatch");
    });

    it("rejects an order without checkoutIntentId", async () => {
      await service.handleOrderWebhook(
        paidOrder({ checkoutIntentId: undefined }),
      );

      expectRejected("checkout_intent_mismatch");
    });

    it("rejects when the booking has no recorded checkout intent", async () => {
      prisma.seatBooking.findUnique.mockResolvedValue({
        ...bookingForCheck,
        paymentId: null,
      } as any);

      await service.handleOrderWebhook(paidOrder());

      expectRejected("checkout_intent_mismatch");
    });

    it("rejects a booking created before #381 (no expected amount)", async () => {
      prisma.seatBooking.findUnique.mockResolvedValue({
        ...bookingForCheck,
        expectedAmountCents: null,
      } as any);

      await service.handleOrderWebhook(paidOrder());

      expectRejected("no_expected_amount");
    });

    it("logs only identifiers on rejection", async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 1, state: "Authorized" }] }),
      );

      expect(errorSpy).toHaveBeenCalledWith(
        "HelloAsso order 98765 rejected for booking booking-1: amount_mismatch",
      );
      errorSpy.mockRestore();
    });

    describe("late payment of an expired hold (#401)", () => {
      const expireCall = {
        where: {
          id: "booking-1",
          status: "PENDING",
          OR: [{ expiresAt: null }, { expiresAt: { lte: expect.any(Date) } }],
        },
        data: { status: "EXPIRED" },
      };

      const markerCall = {
        where: {
          id: "booking-1",
          status: { in: ["EXPIRED", "CONFIRMED"] },
          NOT: { refundOwedPaymentIds: { has: "4242" } },
        },
        data: {
          refundOwedPaymentIds: { push: "4242" },
          refundOwedAt: expect.any(Date),
        },
      };

      const expectRefundFlagged = () => {
        expect(prisma.seatBooking.updateMany).not.toHaveBeenCalledWith(
          confirmCall,
        );
        expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(markerCall);
        expect(refundOwedAlert.alertClub).toHaveBeenCalledWith(
          "booking-1",
          98765,
        );
        expectRefundAlert();
      };

      const expectRefundAlert = () => {
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          "HelloAsso order rejected",
          expect.objectContaining({
            level: "error",
            tags: expect.objectContaining({
              reason: "booking_expired",
              refund: "required",
            }),
            extra: { bookingId: "booking-1", orderId: 98765 },
          }),
        );
      };

      it("does not confirm a PENDING hold past its deadline and frees the seat", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          expiresAt: new Date(Date.now() - 1000),
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expectRefundFlagged();
        expect(prisma.seatBooking.updateMany).toHaveBeenCalledTimes(2);
        expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(expireCall);
      });

      it("does not confirm a PENDING hold without a deadline (fail-closed)", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          expiresAt: null,
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expectRefundFlagged();
      });

      it("flags a paid order for a hold already switched to EXPIRED", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          status: "EXPIRED",
          expiresAt: new Date(Date.now() - 60_000),
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expectRefundFlagged();
        expect(prisma.seatBooking.updateMany).toHaveBeenCalledTimes(1);
      });

      it("still reports a forged order on an expired hold as a forgery, not a refund", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          status: "EXPIRED",
        } as any);

        await service.handleOrderWebhook(paidOrder({ checkoutIntentId: 1 }));

        expectRejected("checkout_intent_mismatch");
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          "HelloAsso order rejected",
          expect.objectContaining({
            tags: {
              payment: "helloasso-order-rejected",
              reason: "checkout_intent_mismatch",
            },
          }),
        );
      });

      it("does not flag a refund when a concurrent redelivery already confirmed the seat", async () => {
        prisma.seatBooking.findUnique
          .mockResolvedValueOnce(bookingForCheck as any)
          .mockResolvedValueOnce({
            ...bookingForCheck,
            status: "CONFIRMED",
          } as any);
        prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

        await service.handleOrderWebhook(paidOrder());

        expect(Sentry.captureMessage).not.toHaveBeenCalled();
      });

      it("flags a hold that expired between the read and the write", async () => {
        prisma.seatBooking.findUnique
          .mockResolvedValueOnce({
            ...bookingForCheck,
            expiresAt: new Date(Date.now() + 5),
          } as any)
          .mockResolvedValueOnce({
            ...bookingForCheck,
            expiresAt: new Date(Date.now() - 1),
          } as any);
        prisma.seatBooking.updateMany.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { count: 0 };
        });

        await service.handleOrderWebhook(paidOrder());

        expectRefundAlert();
        expect(refundOwedAlert.alertClub).toHaveBeenCalled();
      });

      it("does not alert the club twice for the same payment", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...bookingForCheck,
          status: "EXPIRED",
          refundOwedPaymentIds: ["4242"],
        } as any);
        prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

        await service.handleOrderWebhook(paidOrder());

        expectRefundAlert();
        expect(refundOwedAlert.alertClub).not.toHaveBeenCalled();
      });
    });

    describe("resumed payments (#428)", () => {
      const resumed = {
        ...bookingForCheck,
        paymentId: "5000",
        supersededPaymentIds: ["4242", "4300"],
      };

      it("confirms a payment made on an earlier intent of the booking", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue(resumed as any);

        await service.handleOrderWebhook(paidOrder());

        expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith({
          where: { ...confirmCall.where, paymentId: "5000" },
          data: {
            status: "CONFIRMED",
            paymentId: "4242",
            supersededPaymentIds: ["4300", "5000"],
          },
        });
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
      });

      it("still rejects an intent that is not one of the booking's", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue(resumed as any);

        await service.handleOrderWebhook(paidOrder({ checkoutIntentId: 1 }));

        expectRejected("checkout_intent_mismatch");
      });

      it("flags a refund for a second payment of a confirmed seat", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...resumed,
          status: "CONFIRMED",
        } as any);

        await service.handleOrderWebhook(paidOrder());

        expect(prisma.seatBooking.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith({
          where: {
            id: "booking-1",
            status: { in: ["EXPIRED", "CONFIRMED"] },
            NOT: { refundOwedPaymentIds: { has: "4242" } },
          },
          data: {
            refundOwedPaymentIds: { push: "4242" },
            refundOwedAt: expect.any(Date),
          },
        });
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          "HelloAsso order rejected",
          expect.objectContaining({
            tags: expect.objectContaining({
              reason: "duplicate_payment",
              refund: "required",
            }),
          }),
        );
        expect(refundOwedAlert.alertClub).toHaveBeenCalledWith(
          "booking-1",
          98765,
        );
      });

      it("only logs an unpaid earlier intent of a confirmed seat (forgeable, no Sentry)", async () => {
        prisma.seatBooking.findUnique.mockResolvedValue({
          ...resumed,
          status: "CONFIRMED",
        } as any);

        await service.handleOrderWebhook(
          paidOrder({ payments: [{ amount: 1500, state: "Refunded" }] }),
        );

        expect(prisma.seatBooking.updateMany).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
      });

      it("asks HelloAsso to redeliver when the booking was resumed during the confirmation", async () => {
        prisma.seatBooking.findUnique
          .mockResolvedValueOnce(bookingForCheck as any)
          .mockResolvedValueOnce(resumed as any);
        prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.handleOrderWebhook(paidOrder())).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
      });
    });

    it("propagates database errors so HelloAsso retries", async () => {
      prisma.seatBooking.findUnique.mockRejectedValue(new Error("DB down"));

      await expect(service.handleOrderWebhook(paidOrder())).rejects.toThrow(
        "DB down",
      );
    });
  });
});
