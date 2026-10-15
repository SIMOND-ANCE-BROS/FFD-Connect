import {
  parentalConsentControllerGetMine,
  parentalConsentControllerRequest,
} from "../../../api/generated";
import {
  ParentalConsentApi,
  ParentalConsentApiError,
  toParentalConsentError,
} from "../parental-consent-api";

jest.mock("../../../api/generated", () => ({
  parentalConsentControllerGetMine: jest.fn(),
  parentalConsentControllerRequest: jest.fn(),
}));

const getMine = parentalConsentControllerGetMine as jest.Mock;
const request = parentalConsentControllerRequest as jest.Mock;

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: { status },
});
const ko = (status: number) => ({
  data: undefined,
  error: { message: "x" },
  response: { status },
});

describe("ParentalConsentApi (#61)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getMine", () => {
    it("returns the server state", async () => {
      getMine.mockResolvedValue(ok({ state: "PENDING" }));
      await expect(ParentalConsentApi.getMine()).resolves.toEqual({
        state: "PENDING",
      });
    });

    it("reads the store-review empty body as NOT_REQUIRED", async () => {
      getMine.mockResolvedValue(ok({}));
      await expect(ParentalConsentApi.getMine()).resolves.toEqual({
        state: "NOT_REQUIRED",
      });
    });

    it("reads a backend without the route (404) as NOT_REQUIRED", async () => {
      getMine.mockResolvedValue(ko(404));
      await expect(ParentalConsentApi.getMine()).resolves.toEqual({
        state: "NOT_REQUIRED",
      });
    });

    it("throws on any other failure — never hides the banner", async () => {
      getMine.mockResolvedValue(ko(500));
      await expect(ParentalConsentApi.getMine()).rejects.toBeInstanceOf(
        ParentalConsentApiError,
      );
      getMine.mockRejectedValue(new Error("network"));
      await expect(ParentalConsentApi.getMine()).rejects.toMatchObject({
        status: undefined,
      });
    });
  });

  describe("request", () => {
    it("sends the parent's address and returns the new state", async () => {
      request.mockResolvedValue(ok({ state: "PENDING" }));
      await expect(
        ParentalConsentApi.request("parent@example.fr"),
      ).resolves.toEqual({ state: "PENDING" });
      expect(request).toHaveBeenCalledWith({
        body: { parentEmail: "parent@example.fr" },
      });
    });

    it.each([
      [400, "pas la vôtre"],
      [409, "déjà donné son accord"],
      [429, "Trop de demandes"],
      [503, "n'a pas pu être envoyé"],
    ])("explains a %i", async (status, text) => {
      request.mockResolvedValue(ko(status));
      await expect(ParentalConsentApi.request("p@example.fr")).rejects.toThrow(
        text,
      );
    });

    it("falls back to a generic message", async () => {
      request.mockResolvedValue(ko(500));
      await expect(
        ParentalConsentApi.request("p@example.fr"),
      ).rejects.toMatchObject({ status: 500 });
      request.mockResolvedValue({ data: undefined, error: undefined });
      await expect(
        ParentalConsentApi.request("p@example.fr"),
      ).rejects.toBeInstanceOf(ParentalConsentApiError);
      request.mockRejectedValue(new Error("offline"));
      await expect(ParentalConsentApi.request("p@example.fr")).rejects.toThrow(
        "connexion",
      );
    });
  });

  it("builds errors with their status", () => {
    const error = toParentalConsentError(409, "fallback");
    expect(error.status).toBe(409);
    expect(error.name).toBe("ParentalConsentApiError");
    expect(toParentalConsentError(undefined, "fallback").message).toBe(
      "fallback",
    );
  });
});
