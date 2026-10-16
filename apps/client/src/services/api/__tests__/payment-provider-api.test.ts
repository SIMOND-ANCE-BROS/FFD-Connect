import {
  clubsControllerGetPaymentProvider,
  clubsControllerSetPaymentProvider,
} from "../../../api/generated";
import {
  PaymentProviderApi,
  PaymentProviderApiError,
  canChoosePaymentProvider,
  isHelloAssoProvider,
  paymentProviderLabel,
} from "../payment-provider-api";

jest.mock("../../../api/generated", () => ({
  clubsControllerGetPaymentProvider: jest.fn(),
  clubsControllerSetPaymentProvider: jest.fn(),
}));

const getProvider = clubsControllerGetPaymentProvider as jest.Mock;
const setProvider = clubsControllerSetPaymentProvider as jest.Mock;

const status = {
  clubName: "Club Test",
  paymentProvider: "HELLOASSO",
  configured: true,
  selectableProviders: ["HELLOASSO"],
};

const ok = (data: unknown, code = 200) => ({
  data,
  error: undefined,
  response: { status: code },
});
const ko = (code: number, error: unknown = { message: "x" }) => ({
  data: undefined,
  error,
  response: { status: code },
});

describe("PaymentProviderApi (#665)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getStatus", () => {
    it("returns the club's connector", async () => {
      getProvider.mockResolvedValue(ok(status));
      await expect(PaymentProviderApi.getStatus()).resolves.toEqual(status);
    });

    it("returns null for a backend without the route", async () => {
      getProvider.mockResolvedValue(ko(404));
      await expect(PaymentProviderApi.getStatus()).resolves.toBeNull();
    });

    it("returns null for the store-review empty body", async () => {
      getProvider.mockResolvedValue(ok({}));
      await expect(PaymentProviderApi.getStatus()).resolves.toBeNull();
    });

    it("returns null on a network failure", async () => {
      getProvider.mockRejectedValue(new Error("network"));
      await expect(PaymentProviderApi.getStatus()).resolves.toBeNull();
    });
  });

  describe("setProvider", () => {
    it("sends the chosen connector and returns the new status", async () => {
      setProvider.mockResolvedValue(ok(status));
      await expect(PaymentProviderApi.setProvider("HELLOASSO")).resolves.toBe(
        status,
      );
      expect(setProvider).toHaveBeenCalledWith({
        body: { paymentProvider: "HELLOASSO" },
      });
    });

    it("shows the server's reason when the connector is refused", async () => {
      setProvider.mockResolvedValue(
        ko(400, {
          message: ["Ce connecteur de paiement n'est pas encore disponible"],
        }),
      );
      const error = await PaymentProviderApi.setProvider("HELLOASSO").catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PaymentProviderApiError);
      expect((error as PaymentProviderApiError).message).toBe(
        "Ce connecteur de paiement n'est pas encore disponible",
      );
      expect((error as PaymentProviderApiError).status).toBe(400);
    });

    it("falls back to a generic message without a server reason", async () => {
      setProvider.mockResolvedValue(ko(500, {}));
      await expect(
        PaymentProviderApi.setProvider("HELLOASSO"),
      ).rejects.toMatchObject({ message: "L'opération a échoué", status: 500 });
    });

    it("reports a network failure", async () => {
      setProvider.mockRejectedValue(new Error("network"));
      await expect(
        PaymentProviderApi.setProvider("HELLOASSO"),
      ).rejects.toMatchObject({ status: undefined });
    });
  });

  describe("helpers", () => {
    it("labels the connectors", () => {
      expect(paymentProviderLabel("HELLOASSO")).toBe("HelloAsso");
      // A connector this build does not know yet keeps its server name.
      expect(paymentProviderLabel("ASSOCONNECT")).toBe("ASSOCONNECT");
    });

    it("knows which connector has the HelloAsso credentials form", () => {
      expect(isHelloAssoProvider("HELLOASSO")).toBe(true);
      expect(isHelloAssoProvider("ASSOCONNECT")).toBe(false);
    });

    it("offers a choice only with more than one connector", () => {
      expect(canChoosePaymentProvider(null)).toBe(false);
      expect(canChoosePaymentProvider(status as never)).toBe(false);
      expect(
        canChoosePaymentProvider({
          selectableProviders: ["HELLOASSO", "OTHER" as never],
        }),
      ).toBe(true);
    });
  });
});
