import type { ClubsHelloAssoService } from "../../clubs/clubs-helloasso.service";
import type { HelloAssoService } from "../hello-asso.service";
import { HelloAssoPaymentConnector } from "./helloasso-payment.connector";
import type { PaymentCheckoutRequest } from "./payment-connector";

describe("HelloAssoPaymentConnector (#388)", () => {
  const credentials = {
    clientId: "client-id",
    clientSecret: "client-secret",
    organizationSlug: "org-slug",
  };
  const request: PaymentCheckoutRequest = {
    amountCents: 1500,
    label: "Place Compétition - A1",
    payer: { email: "a@b.fr", firstName: "Ada", lastName: "Lovelace" },
    metadata: { bookingId: "booking-1", competitionId: "comp-1" },
    appBaseUrl: "https://app.example.com",
  };

  let createCheckoutIntent: jest.Mock;
  let getCheckoutIntent: jest.Mock;
  let getCredentials: jest.Mock;
  let connector: HelloAssoPaymentConnector;

  beforeEach(() => {
    createCheckoutIntent = jest.fn();
    getCheckoutIntent = jest.fn();
    getCredentials = jest.fn().mockResolvedValue(credentials);
    connector = new HelloAssoPaymentConnector(
      {
        createCheckoutIntent,
        getCheckoutIntent,
      } as unknown as HelloAssoService,
      {
        getHelloAssoCredentialsForCompetition: getCredentials,
      } as unknown as ClubsHelloAssoService,
    );
  });

  it("is the HELLOASSO connector, named for users", () => {
    expect(connector.provider).toBe("HELLOASSO");
    expect(connector.displayName).toBe("HelloAsso");
  });

  it("has no account when the organising club has no HelloAsso credentials", async () => {
    getCredentials.mockResolvedValue(null);

    await expect(connector.accountForCompetition("comp-1")).resolves.toBe(null);
    expect(getCredentials).toHaveBeenCalledWith("comp-1");
  });

  it("creates the checkout intent with the club's credentials and the request as is", async () => {
    createCheckoutIntent.mockResolvedValue({
      id: 4242,
      redirectUrl: "https://helloasso.com/pay/4242",
      extra: "ignored",
    });
    const account = await connector.accountForCompetition("comp-1");

    await expect(account?.createCheckout(request)).resolves.toEqual({
      id: "4242",
      redirectUrl: "https://helloasso.com/pay/4242",
    });
    expect(account?.provider).toBe("HELLOASSO");
    expect(createCheckoutIntent).toHaveBeenCalledWith(
      credentials,
      "https://app.example.com",
      {
        amount: 1500,
        label: "Place Compétition - A1",
        consumerEmail: "a@b.fr",
        consumerFirstName: "Ada",
        consumerLastName: "Lovelace",
        metadata: { bookingId: "booking-1", competitionId: "comp-1" },
      },
    );
  });

  it("propagates a checkout failure", async () => {
    createCheckoutIntent.mockRejectedValue(new Error("boom"));
    const account = await connector.accountForCompetition("comp-1");

    await expect(account?.createCheckout(request)).rejects.toThrow("boom");
  });

  it.each([
    ["an authorised order", { found: true, value: { order: { id: 1 } } }, true],
    ["no order yet", { found: true, value: {} }, false],
    [
      "an order that is not an object",
      { found: true, value: { order: [1] } },
      false,
    ],
    ["an unknown intent", { found: false }, false],
  ])(
    "reports a payment on the checkout only for %s",
    async (_label, read, expected) => {
      getCheckoutIntent.mockResolvedValue(read);
      const account = await connector.accountForCompetition("comp-1");

      await expect(account?.hasPaymentOnCheckout("4242")).resolves.toBe(
        expected,
      );
      expect(getCheckoutIntent).toHaveBeenCalledWith(credentials, "4242");
    },
  );

  it("throws when HelloAsso cannot be read (never guessed)", async () => {
    getCheckoutIntent.mockRejectedValue(new Error("timeout"));
    const account = await connector.accountForCompetition("comp-1");

    await expect(account?.hasPaymentOnCheckout("4242")).rejects.toThrow(
      "timeout",
    );
  });
});
