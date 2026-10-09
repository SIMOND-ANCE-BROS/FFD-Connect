import { act, renderHook } from "@testing-library/react-native";
import { Linking } from "react-native";
import { useIsOnline } from "../../../../hooks/useIsOnline";
import { analytics } from "../../../../services/analytics";
import {
  AppleWalletLinkError,
  LicenseApi,
} from "../../../../services/api/license-api";
import type { LicenseUser } from "../../components/LicenseCard";
import {
  canAddLicenseToAppleWallet,
  useAppleWalletPass,
} from "../useAppleWalletPass";

jest.mock("../../../../hooks/useIsOnline", () => ({
  useIsOnline: jest.fn(() => true),
}));
jest.mock("../../../../services/analytics", () => ({
  analytics: { logEvent: jest.fn(), logScreenView: jest.fn() },
}));
jest.mock("../../../../services/api/license-api", () => {
  const actual = jest.requireActual<
    typeof import("../../../../services/api/license-api")
  >("../../../../services/api/license-api");
  return {
    ...actual,
    LicenseApi: { createAppleWalletPassUrl: jest.fn() },
  };
});

const PASS_URL =
  "https://api.example.test/api/v1/licenses/wallet/apple/" + "t".repeat(43);
const mockCreateUrl = LicenseApi.createAppleWalletPassUrl as jest.Mock;
const mockUseIsOnline = useIsOnline as jest.Mock;

const license = (overrides: Partial<LicenseUser> = {}): LicenseUser => ({
  firstName: "Ada",
  lastName: "LOVELACE",
  birthDate: "01/01/2000",
  licenseNumber: "123456",
  validUntil: "31/08/2099",
  validUntilRaw: "2099-08-31T00:00:00.000Z",
  type: "Athlète",
  appleWalletAvailable: true,
  ...overrides,
});

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseIsOnline.mockReturnValue(true);
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

describe("canAddLicenseToAppleWallet", () => {
  const now = new Date("2026-10-09T00:00:00Z");

  it("is true on iOS with the flag and a future end date", () => {
    expect(canAddLicenseToAppleWallet(license(), "ios", now)).toBe(true);
  });

  it.each([
    ["Android", license(), "android"],
    ["web", license(), "web"],
    ["the server flag off", license({ appleWalletAvailable: false }), "ios"],
    [
      "the server flag absent (older backend)",
      license({ appleWalletAvailable: undefined }),
      "ios",
    ],
    [
      "an expired license",
      license({ validUntilRaw: "2026-01-01T00:00:00Z" }),
      "ios",
    ],
    ["no end date", license({ validUntilRaw: undefined }), "ios"],
    ["an invalid end date", license({ validUntilRaw: "not-a-date" }), "ios"],
  ])("is false with %s", (_label, value, platform) => {
    expect(canAddLicenseToAppleWallet(value, platform, now)).toBe(false);
  });

  it("is false without a license", () => {
    expect(canAddLicenseToAppleWallet(null, "ios", now)).toBe(false);
  });
});

describe("useAppleWalletPass", () => {
  it("opens the recomposed pass URL in Safari and logs the event", async () => {
    mockCreateUrl.mockResolvedValue(PASS_URL);
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: false }),
    );

    expect(result.current.state.visible).toBe(true);
    await act(() => result.current.addToWallet());

    expect(openURL).toHaveBeenCalledWith(PASS_URL);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.loading).toBe(false);
    expect(analytics.logEvent).toHaveBeenCalledWith("license_wallet_add", {
      wallet: "apple",
      outcome: "opened",
    });
  });

  it("is loading while the link is requested", async () => {
    let resolve: (url: string) => void = () => {};
    mockCreateUrl.mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: false }),
    );

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.addToWallet();
    });
    expect(result.current.state.loading).toBe(true);

    // A second tap while in flight does not issue a second link.
    await act(() => result.current.addToWallet());
    expect(mockCreateUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(PASS_URL);
      await pending;
    });
    expect(result.current.state.loading).toBe(false);
  });

  it("shows the translated API error and does not open Safari", async () => {
    mockCreateUrl.mockRejectedValue(
      new AppleWalletLinkError("Votre licence est expirée.", 422),
    );
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: false }),
    );

    await act(() => result.current.addToWallet());

    expect(openURL).not.toHaveBeenCalled();
    expect(result.current.state.error).toBe("Votre licence est expirée.");
    expect(analytics.logEvent).toHaveBeenCalledWith("license_wallet_add", {
      wallet: "apple",
      outcome: "error",
      status: 422,
    });
  });

  it("shows a generic message when Safari cannot be opened", async () => {
    mockCreateUrl.mockResolvedValue(PASS_URL);
    openURL.mockRejectedValue(new Error("cannot open"));
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: false }),
    );

    await act(() => result.current.addToWallet());

    expect(result.current.state.error).toContain("a échoué");
  });

  it("clears the previous error on a new attempt", async () => {
    mockCreateUrl
      .mockRejectedValueOnce(new AppleWalletLinkError("Indisponible", 503))
      .mockResolvedValueOnce(PASS_URL);
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: false }),
    );

    await act(() => result.current.addToWallet());
    expect(result.current.state.error).toBe("Indisponible");
    await act(() => result.current.addToWallet());
    expect(result.current.state.error).toBeNull();
  });

  it.each([
    ["the device is offline", false, false],
    ["the license comes from the offline snapshot", true, true],
  ])("does nothing when %s", async (_label, online, snapshot) => {
    mockUseIsOnline.mockReturnValue(online);
    const { result } = await renderHook(() =>
      useAppleWalletPass(license(), { servedFromSnapshot: snapshot }),
    );

    expect(result.current.state.offline).toBe(true);
    await act(() => result.current.addToWallet());
    expect(mockCreateUrl).not.toHaveBeenCalled();
  });
});
