import { BadRequestException, Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { PaymentService } from "./payment.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));
import { HelloAssoService } from "./hello-asso.service";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";

describe("PaymentService", () => {
  let service: PaymentService;
  let prisma: DeepMockProxy<PrismaClient>;
  let helloAssoService: jest.Mocked<
    Pick<HelloAssoService, "createCheckoutIntent">
  >;
  let clubsService: jest.Mocked<
    Pick<ClubsHelloAssoService, "getHelloAssoCredentialsForCompetition">
  >;
  let configService: jest.Mocked<Pick<ConfigService, "get">>;

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

  const mockBooking = {
    id: "booking-1",
    competitionId: "comp-1",
    userId: "user-1",
    itemId: "item-1",
    seatLabel: "A1",
    status: "PENDING",
    expiresAt: new Date(),
    paymentId: null,
  };

  const mockIntent = {
    id: "intent-1",
    redirectUrl: "https://helloasso.com/checkout/intent-1",
  };

  const mockDto = {
    competitionId: "comp-1",
    itemId: "item-1",
    seatLabel: "A1",
    // Tampered amount sent by the client: must be ignored (#381).
    amount: 1,
  };

  const SEAT_PRICE_CENTS = 1500;
  const mockCompetition = {
    id: "comp-1",
    layout: [
      { id: "other-item", priceCents: 9900 },
      { id: "item-1", label: "Table 1", priceCents: SEAT_PRICE_CENTS },
    ],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();

    helloAssoService = {
      createCheckoutIntent: jest.fn(),
    };

    clubsService = {
      getHelloAssoCredentialsForCompetition: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue("https://app.example.com"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: HelloAssoService, useValue: helloAssoService },
        { provide: ClubsHelloAssoService, useValue: clubsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);
  });

  describe("createCheckout", () => {
    it("throws BadRequestException when no HelloAsso credentials found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        null,
      );

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /HelloAsso/,
      );
    });

    it("does not call prisma when credentials are missing", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        null,
      );

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when user is not found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "User not found",
      );
    });

    it("does not create booking when user is not found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.seatBooking.create).not.toHaveBeenCalled();
    });

    it("creates a PENDING booking with correct data", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: "intent-1",
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(prisma.seatBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            competitionId: mockDto.competitionId,
            userId: mockUser.id,
            itemId: mockDto.itemId,
            seatLabel: mockDto.seatLabel,
            status: "PENDING",
            expectedAmountCents: SEAT_PRICE_CENTS,
          }),
        }),
      );
    });

    it("calls HelloAsso createCheckoutIntent with correct params", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: "intent-1",
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({
          amount: SEAT_PRICE_CENTS,
          consumerEmail: mockUser.email,
          consumerFirstName: mockUser.firstName,
          consumerLastName: mockUser.lastName,
          metadata: expect.objectContaining({
            bookingId: mockBooking.id,
            competitionId: mockDto.competitionId,
          }),
        }),
      );
    });

    it("updates booking paymentId after successful HelloAsso intent creation", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: mockBooking.id },
        data: { paymentId: mockIntent.id },
      });
    });

    it("returns the checkout intent on success", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      const result = await service.createCheckout("user-1", mockDto);

      expect(result).toEqual(mockIntent);
    });

    it("deletes booking when HelloAsso createCheckoutIntent throws", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("HelloAsso API error"),
      );
      prisma.seatBooking.delete.mockResolvedValue(mockBooking as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.seatBooking.delete).toHaveBeenCalledWith({
        where: { id: mockBooking.id },
      });
    });

    it("throws BadRequestException when HelloAsso fails", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("Network error"),
      );
      prisma.seatBooking.delete.mockResolvedValue(mockBooking as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /paiement/,
      );
    });

    it("does not throw even if booking deletion fails during cleanup", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("HelloAsso error"),
      );
      // Simulate deletion also failing — the service should swallow this
      prisma.seatBooking.delete.mockRejectedValue(new Error("DB error"));

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("propagates error when seatBooking.create throws", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockRejectedValue(new Error("DB write error"));

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "DB write error",
      );
      expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
    });

    it("uses fallback APP_URL when configService returns undefined", async () => {
      configService.get.mockReturnValue(undefined);
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      const result = await service.createCheckout("user-1", mockDto);

      expect(result).toEqual(mockIntent);
      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        "https://app.example.com",
        expect.any(Object),
      );
    });

    it("uses seatLabel in the intent label when provided", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", { ...mockDto, seatLabel: "B3" });

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({ label: "Place Compétition - B3" }),
      );
    });

    it("falls back to itemId in label when seatLabel is not provided", async () => {
      const dtoWithoutSeatLabel = {
        competitionId: "comp-1",
        itemId: "item-1",
        amount: 1500,
      };
      const bookingWithoutSeatLabel = { ...mockBooking, seatLabel: null };

      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(
        bookingWithoutSeatLabel as any,
      );
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...bookingWithoutSeatLabel,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", dtoWithoutSeatLabel);

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({ label: "Place Compétition - item-1" }),
      );
    });
  });

  describe("createCheckout — server-side price (#381)", () => {
    beforeEach(() => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue(mockBooking as any);
    });

    it("ignores the client amount and charges the layout price", async () => {
      await service.createCheckout("user-1", { ...mockDto, amount: 1 });

      expect(prisma.competition.findUnique).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        select: { id: true, layout: true },
      });
      const params = helloAssoService.createCheckoutIntent.mock.calls[0][2];
      expect(params.amount).toBe(SEAT_PRICE_CENTS);
    });

    it("works for a client that no longer sends an amount", async () => {
      await service.createCheckout("user-1", {
        competitionId: "comp-1",
        itemId: "item-1",
      });

      const params = helloAssoService.createCheckoutIntent.mock.calls[0][2];
      expect(params.amount).toBe(SEAT_PRICE_CENTS);
    });

    it("stores the numeric HelloAsso intent id as a string", async () => {
      helloAssoService.createCheckoutIntent.mockResolvedValue({
        ...mockIntent,
        id: 4242 as unknown as string,
      });

      await service.createCheckout("user-1", mockDto);

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: mockBooking.id },
        data: { paymentId: "4242" },
      });
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
      expect(prisma.seatBooking.create).not.toHaveBeenCalled();
      expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
    });
  });

  describe("handleOrderWebhook (#381)", () => {
    const bookingForCheck = {
      id: "booking-1",
      competitionId: "comp-1",
      status: "PENDING",
      paymentId: "4242",
      expectedAmountCents: 1500,
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
      where: { id: "booking-1", status: "PENDING", expectedAmountCents: 1500 },
      data: { status: "CONFIRMED" },
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
        select: {
          id: true,
          competitionId: true,
          status: true,
          paymentId: true,
          expectedAmountCents: true,
        },
      });
      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith(confirmCall);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("accepts the legacy data.metadata location and Processed state", async () => {
      await service.handleOrderWebhook({
        eventType: "Order",
        data: {
          checkoutIntentId: 4242,
          metadata: { bookingId: "booking-1", competitionId: "comp-1" },
          payments: [{ amount: 1500, state: "Processed" }],
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

    it.each(["CANCELLED", "EXPIRED", "SOMETHING_NEW"])(
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
      prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

      await service.handleOrderWebhook(paidOrder());

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "HelloAsso order rejected",
        expect.objectContaining({
          tags: expect.objectContaining({ reason: "not_pending" }),
        }),
      );
    });

    it("rejects an unpaid order (refused payment)", async () => {
      await service.handleOrderWebhook(
        paidOrder({ payments: [{ amount: 1500, state: "Refused" }] }),
      );

      expectRejected("not_paid");
    });

    it.each(["Pending", "Refunded", "Unknown", "authorized", ""])(
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

    it("propagates database errors so HelloAsso retries", async () => {
      prisma.seatBooking.findUnique.mockRejectedValue(new Error("DB down"));

      await expect(service.handleOrderWebhook(paidOrder())).rejects.toThrow(
        "DB down",
      );
    });
  });

  describe("confirmBooking", () => {
    it("calls seatBooking.update with CONFIRMED status", async () => {
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        status: "CONFIRMED",
      } as any);

      await service.confirmBooking("booking-1");

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: "booking-1" },
        data: { status: "CONFIRMED" },
      });
    });

    it("propagates prisma errors", async () => {
      prisma.seatBooking.update.mockRejectedValue(new Error("DB error"));

      await expect(service.confirmBooking("booking-1")).rejects.toThrow(
        "DB error",
      );
    });
  });
});
