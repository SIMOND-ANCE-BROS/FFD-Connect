import {
  privacyPolicyControllerAcknowledge,
  privacyPolicyControllerGetNotice,
} from "../../../api/generated";
import { PrivacyPolicyApi } from "../privacy-policy-api";

jest.mock("../../../api/generated", () => ({
  privacyPolicyControllerGetNotice: jest.fn(),
  privacyPolicyControllerAcknowledge: jest.fn(),
}));

const getNotice = privacyPolicyControllerGetNotice as jest.Mock;
const acknowledge = privacyPolicyControllerAcknowledge as jest.Mock;

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

describe("PrivacyPolicyApi (#734)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("pendingVersion", () => {
    it("returns the version to announce", async () => {
      getNotice.mockResolvedValue(
        ok({ currentVersion: "2026-10-17", seenVersion: null, pending: true }),
      );
      await expect(PrivacyPolicyApi.pendingVersion()).resolves.toBe(
        "2026-10-17",
      );
    });

    it("returns null once the version is acknowledged", async () => {
      getNotice.mockResolvedValue(
        ok({
          currentVersion: "2026-10-17",
          seenVersion: "2026-10-17",
          pending: false,
        }),
      );
      await expect(PrivacyPolicyApi.pendingVersion()).resolves.toBeNull();
    });

    it.each([
      ["the store-review empty body", () => ok({})],
      ["a backend without the route", () => ko(404)],
      ["a server error", () => ko(503)],
      ["a malformed body", () => ok({ pending: true, currentVersion: 3 })],
    ])("reads %s as nothing to show", async (_label, response) => {
      getNotice.mockResolvedValue(response());
      await expect(PrivacyPolicyApi.pendingVersion()).resolves.toBeNull();
    });

    it("reads a network failure as nothing to show", async () => {
      getNotice.mockRejectedValue(new Error("Network Error"));
      await expect(PrivacyPolicyApi.pendingVersion()).resolves.toBeNull();
    });
  });

  describe("acknowledge", () => {
    it("sends the version read", async () => {
      acknowledge.mockResolvedValue(ok({ pending: false }));
      await expect(PrivacyPolicyApi.acknowledge("2026-10-17")).resolves.toBe(
        true,
      );
      expect(acknowledge).toHaveBeenCalledWith({
        body: { version: "2026-10-17" },
      });
    });

    it("reports a refusal (stale version)", async () => {
      acknowledge.mockResolvedValue(ko(409));
      await expect(PrivacyPolicyApi.acknowledge("2020-01-01")).resolves.toBe(
        false,
      );
    });

    it("reports a network failure", async () => {
      acknowledge.mockRejectedValue(new Error("Network Error"));
      await expect(PrivacyPolicyApi.acknowledge("2026-10-17")).resolves.toBe(
        false,
      );
    });
  });
});
