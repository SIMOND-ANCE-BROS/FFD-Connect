import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PaymentProvider, PrismaClient } from "@prisma/client";
import { mockDeep, type DeepMockProxy } from "jest-mock-extended";
import type { PrismaService } from "../prisma/prisma.service";
import type {
  PaymentAccount,
  PaymentConnector,
} from "./connectors/payment-connector";
import type { PaymentConnectorRegistry } from "./connectors/payment-connector.registry";
import type { PaymentNotificationService } from "./payment-notification.service";
import { PaymentService } from "./payment.service";
import type { RefundOwedAlertService } from "./refund-owed-alert.service";
import type { HeldBooking, SeatHoldService } from "./seat-hold.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

/**
 * PaymentService against a FAKE connector (#388): the checkout only goes
 * through the `PaymentConnector` interface, whatever the provider.
 */
describe("PaymentService with any payment connector (#388)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let account: jest.Mocked<PaymentAccount>;
  let connector: PaymentConnector;
  let forCompetition: jest.Mock;
  let seatHold: {
    hold: jest.Mock;
    recordIntent: jest.Mock;
    replaceIntent: jest.Mock;
    release: jest.Mock;
  };
  let service: PaymentService;

  const booking = (overrides: Partial<HeldBooking> = {}): HeldBooking => ({
    id: "booking-1",
    seatIndex: 0,
    expiresAt: new Date(Date.now() + 50 * 60 * 1000),
    createdAt: new Date(),
    expectedAmountCents: 1500,
    paymentId: null,
    checkoutRedirectUrl: null,
    checkoutCreatedAt: null,
    supersededPaymentIds: [],
    ...overrides,
  });
  const dto = { competitionId: "comp-1", itemId: "item-1", amount: 1 };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.competition.findUnique.mockResolvedValue({
      id: "comp-1",
      layout: [{ id: "item-1", type: "OTHER", capacity: 10, priceCents: 1500 }],
    } as never);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "a@b.fr",
      firstName: "Ada",
      lastName: "Lovelace",
    } as never);
    account = {
      provider: "FAKEPAY" as PaymentProvider,
      createCheckout: jest
        .fn()
        .mockResolvedValue({ id: "77", redirectUrl: "https://fake.pay/77" }),
      hasPaymentOnCheckout: jest.fn().mockResolvedValue(false),
    };
    connector = {
      provider: "FAKEPAY" as PaymentProvider,
      displayName: "FakePay",
      accountForCompetition: jest.fn().mockResolvedValue(account),
    };
    forCompetition = jest.fn().mockResolvedValue(connector);
    seatHold = {
      hold: jest.fn().mockResolvedValue({ resumed: false, booking: booking() }),
      recordIntent: jest.fn().mockResolvedValue(undefined),
      replaceIntent: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    service = new PaymentService(
      prisma as unknown as PrismaService,
      { forCompetition } as unknown as PaymentConnectorRegistry,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      seatHold as unknown as SeatHoldService,
      { alertClub: jest.fn() } as unknown as RefundOwedAlertService,
      {
        notifyPaymentReceived: jest.fn(),
      } as unknown as PaymentNotificationService,
    );
  });

  it("creates the checkout on the club's connector, at the server price", async () => {
    const response = await service.createCheckout("user-1", dto);

    expect(forCompetition).toHaveBeenCalledWith("comp-1");
    expect(connector.accountForCompetition).toHaveBeenCalledWith("comp-1");
    expect(account.createCheckout).toHaveBeenCalledWith({
      amountCents: 1500,
      label: "Place Compétition - item-1",
      payer: { email: "a@b.fr", firstName: "Ada", lastName: "Lovelace" },
      metadata: { bookingId: "booking-1", competitionId: "comp-1" },
      appBaseUrl: "https://app.example.com",
    });
    expect(seatHold.recordIntent).toHaveBeenCalledWith(
      "booking-1",
      { id: "77", redirectUrl: "https://fake.pay/77" },
      expect.any(Date),
    );
    expect(response).toMatchObject({
      id: 77,
      redirectUrl: "https://fake.pay/77",
      bookingId: "booking-1",
      resumed: false,
    });
  });

  it("names the connector when the club has not configured it", async () => {
    (connector.accountForCompetition as jest.Mock).mockResolvedValue(null);

    const error = await service.createCheckout("user-1", dto).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(
      "Le club organisateur de cette compétition n'a pas connecté son compte FakePay. " +
        "L'organisateur doit configurer FakePay dans Paramètres du club.",
    );
    expect(seatHold.hold).not.toHaveBeenCalled();
  });

  it("refuses with a neutral message when the club has no usable connector", async () => {
    forCompetition.mockResolvedValue(null);

    const error = await service.createCheckout("user-1", dto).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toMatch(/paiement en ligne/);
    expect((error as Error).message).not.toMatch(/HelloAsso/);
    expect(seatHold.hold).not.toHaveBeenCalled();
  });

  it("names the connector when it cannot be read on a resumed payment (503)", async () => {
    seatHold.hold.mockResolvedValue({
      resumed: true,
      booking: booking({
        paymentId: "70",
        checkoutRedirectUrl: "https://fake.pay/70",
        checkoutCreatedAt: new Date(Date.now() - 20 * 60 * 1000),
      }),
    });
    account.hasPaymentOnCheckout.mockRejectedValue(new Error("down"));

    const error = await service.createCheckout("user-1", dto).catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toMatch(/^FakePay est momentanément/);
    expect(account.hasPaymentOnCheckout).toHaveBeenCalledWith("70");
    expect(account.createCheckout).not.toHaveBeenCalled();
  });

  it("returns the stored page of a resumed payment as the API's numeric id", async () => {
    seatHold.hold.mockResolvedValue({
      resumed: true,
      booking: booking({
        paymentId: "70",
        checkoutRedirectUrl: "https://fake.pay/70",
        checkoutCreatedAt: new Date(),
      }),
    });

    await expect(service.createCheckout("user-1", dto)).resolves.toMatchObject({
      id: 70,
      redirectUrl: "https://fake.pay/70",
      resumed: true,
    });
    expect(account.createCheckout).not.toHaveBeenCalled();
  });
});
