import {
  cguControllerAccept,
  cguControllerGetAcceptance,
} from "../../../api/generated";
import { CguApi } from "../cgu-api";

jest.mock("../../../api/generated", () => ({
  cguControllerGetAcceptance: jest.fn(),
  cguControllerAccept: jest.fn(),
}));

const getAcceptance = cguControllerGetAcceptance as jest.Mock;
const accept = cguControllerAccept as jest.Mock;

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

describe("CguApi (#894)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("hasAccepted", () => {
    it("is true when the account accepted this version", async () => {
      getAcceptance.mockResolvedValue(
        ok({ currentVersion: "3", acceptedVersion: "3", accepted: true }),
      );
      await expect(CguApi.hasAccepted("3")).resolves.toBe(true);
    });

    it("is false when the account never accepted", async () => {
      getAcceptance.mockResolvedValue(
        ok({ currentVersion: "3", acceptedVersion: null, accepted: false }),
      );
      await expect(CguApi.hasAccepted("3")).resolves.toBe(false);
    });

    it("is false when the account accepted another version", async () => {
      getAcceptance.mockResolvedValue(
        ok({ currentVersion: "3", acceptedVersion: "2", accepted: false }),
      );
      await expect(CguApi.hasAccepted("3")).resolves.toBe(false);
    });

    it.each([
      ["the store-review empty body", () => ok({})],
      ["a backend without the route", () => ko(404)],
      ["a server error", () => ko(503)],
      ["a malformed body", () => ok({ acceptedVersion: 3 })],
      ["no body", () => ok(undefined)],
    ])("reads %s as unknown", async (_label, response) => {
      getAcceptance.mockResolvedValue(response());
      await expect(CguApi.hasAccepted("3")).resolves.toBeNull();
    });

    it("reads a network failure as unknown", async () => {
      getAcceptance.mockRejectedValue(new Error("Network Error"));
      await expect(CguApi.hasAccepted("3")).resolves.toBeNull();
    });
  });

  describe("accept", () => {
    it("sends the version and resolves true", async () => {
      accept.mockResolvedValue(ok({ accepted: true }));
      await expect(CguApi.accept("3")).resolves.toBe(true);
      expect(accept).toHaveBeenCalledWith({ body: { version: "3" } });
    });

    it("resolves false on an error answer", async () => {
      accept.mockResolvedValue(ko(409));
      await expect(CguApi.accept("3")).resolves.toBe(false);
    });

    it("resolves false on a network failure", async () => {
      accept.mockRejectedValue(new Error("Network Error"));
      await expect(CguApi.accept("3")).resolves.toBe(false);
    });
  });
});
