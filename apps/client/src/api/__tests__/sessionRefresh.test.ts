import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { refreshSession, waitForPendingRefresh } from "../sessionRefresh";
import { TokenStoreUnavailableError } from "../tokenStoreErrors";

const mockRefreshAuth = jest.fn();
const mockGetTokens = jest.fn();
const mockSetTokens = jest.fn();
const mockClearBackupTokens = jest.fn();
const mockClearTokens = jest.fn();
const mockClearLicenseSnapshot = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn() },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock("../../config", () => ({
  API_URL: "http://test/api/v1",
  API_TIMEOUT_MS: 1000,
}));
jest.mock("../../stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ refreshAuth: mockRefreshAuth }) },
}));
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));
jest.mock("../tokenStore", () => ({
  getTokens: () => mockGetTokens(),
  setTokensIfRefreshIs: (expected: unknown, t: unknown) =>
    mockSetTokens(expected, t),
  clearImpersonationBackupTokens: () => mockClearBackupTokens(),
  clearTokensIfRefreshIs: (expected: unknown) => mockClearTokens(expected),
  IMPERSONATION_BACKUP_KEY: "impersonation_backup",
  setUnreadableSessionHandler: jest.fn(),
}));
// Captured before any beforeEach clears the mock calls: sessionRefresh
// registers its handler at import time.
const unreadableHandler = jest.requireMock<{
  setUnreadableSessionHandler: jest.Mock;
}>("../tokenStore").setUnreadableSessionHandler.mock.calls[0]?.[0] as
  | (() => Promise<void>)
  | undefined;

jest.mock("../../features/license/utils/licenseSnapshot", () => ({
  clearLicenseSnapshot: () => mockClearLicenseSnapshot() as unknown,
}));
const mockRunSessionEndCleanups = jest.fn();
jest.mock("../../services/sessionCleanup", () => ({
  runSessionEndCleanups: () => mockRunSessionEndCleanups() as unknown,
}));

const post = axios.post as jest.Mock;
const isAxiosError = axios.isAxiosError as unknown as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const getItem = AsyncStorage.getItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  isAxiosError.mockReturnValue(true);
  getItem.mockResolvedValue(
    JSON.stringify({ isLoggedIn: true, role: "LICENSEE" }),
  );
  mockSetTokens.mockResolvedValue(true);
  mockClearBackupTokens.mockResolvedValue(undefined);
  mockClearTokens.mockResolvedValue(true);
});

describe("refreshSession", () => {
  it("returns null when there is no refresh token", async () => {
    mockGetTokens.mockResolvedValue({});
    await expect(refreshSession()).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the session when the token store is unreadable (locked iPhone, #582)", async () => {
    mockGetTokens.mockRejectedValue(
      new TokenStoreUnavailableError(
        new Error("User interaction is not allowed."),
      ),
    );

    await expect(refreshSession()).resolves.toBeNull();

    expect(post).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(mockClearLicenseSnapshot).not.toHaveBeenCalled();
    expect(mockRefreshAuth).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("ends the session visibly when the token store is permanently unreadable", async () => {
    // Registered at import: tokenStore calls it (after clearTokens) when a
    // non-lock read failure persists in the foreground.
    expect(unreadableHandler).toBeInstanceOf(Function);
    await unreadableHandler?.();

    expect(mockClearLicenseSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved.isLoggedIn).toBe(false);
    expect(mockClearBackupTokens).toHaveBeenCalledTimes(1);
  });

  it("a session end resets the impersonation flags, and survives a failed backup cleanup", async () => {
    getItem.mockResolvedValue(
      JSON.stringify({
        isLoggedIn: true,
        impersonating: true,
        impersonatedName: "Club",
      }),
    );
    mockClearBackupTokens.mockRejectedValue(new Error("Keystore failure"));

    await unreadableHandler?.();

    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved).toEqual({ isLoggedIn: false });
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
  });

  it("refreshes and persists the new access + rotated refresh token", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "r2" },
    });

    await expect(refreshSession()).resolves.toBe("new-access");

    // Compare-and-set against the refresh token actually sent.
    expect(mockSetTokens).toHaveBeenCalledWith("r1", {
      authToken: "new-access",
      refreshToken: "r2",
    });
    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved.isLoggedIn).toBe(true);
  });

  it("drops the rotated tokens when the session changed meanwhile (#598 review)", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "r2" },
    });
    mockSetTokens.mockResolvedValue(false);

    // Never handed to the request: it belongs to the previous session.
    await expect(refreshSession()).resolves.toBeNull();

    expect(setItem).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it("a 401 for a previous session never ends the current one (#598 review)", async () => {
    // A stale refresh answered 401 after a new login (cold start).
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockRejectedValue({ response: { status: 401 } });
    mockClearTokens.mockResolvedValue(false);

    await expect(refreshSession()).resolves.toBeNull();

    expect(mockClearTokens).toHaveBeenCalledWith("r1");
    expect(mockClearLicenseSnapshot).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(mockClearBackupTokens).not.toHaveBeenCalled();
    expect(mockRefreshAuth).not.toHaveBeenCalled();
    expect(mockRunSessionEndCleanups).not.toHaveBeenCalled();
  });

  it("waitForPendingRefresh resolves once the refresh in flight settles", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    let release: (v: unknown) => void = () => undefined;
    post.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const steps: string[] = [];

    const refreshing = refreshSession().then(() => steps.push("refresh"));
    const waiting = waitForPendingRefresh().then(() => steps.push("wait"));
    await Promise.resolve();
    release({ data: { access_token: "a2", refresh_token: "r2" } });
    await Promise.all([refreshing, waiting]);

    expect(steps).toEqual(["refresh", "wait"]);
    await expect(waitForPendingRefresh()).resolves.toBeUndefined();
  });

  it("waitForPendingRefresh swallows the refresh's own failure", async () => {
    mockGetTokens.mockRejectedValue(new Error("boom"));
    const refreshing = refreshSession().catch(() => undefined);

    await expect(waitForPendingRefresh()).resolves.toBeUndefined();
    await refreshing;
  });

  it("logs out (clears tokens + notifies store) when refresh is rejected (401)", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockRejectedValue({ response: { status: 401 } });

    await expect(refreshSession()).resolves.toBeNull();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    // The offline license snapshot (PII) ends with the session.
    expect(mockClearLicenseSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved.isLoggedIn).toBe(false);
    // The next account must not find this one's server cache (#879).
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
    // An impersonation backup never outlives the session (#598 review).
    expect(mockClearBackupTokens).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      "impersonation_backup",
    );
  });

  it("also ends the session (and purges the snapshot) on a 403", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockRejectedValue({ response: { status: 403 } });

    await expect(refreshSession()).resolves.toBeNull();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(mockClearLicenseSnapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps the session on a network error (no response) — does not clear", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockRejectedValue({ message: "Network Error" });

    await expect(refreshSession()).resolves.toBeNull();

    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(mockClearLicenseSnapshot).not.toHaveBeenCalled();
    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it("serializes concurrent calls into a single refresh request", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "r2" },
    });

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(a).toBe("new-access");
    expect(b).toBe("new-access");
    expect(post).toHaveBeenCalledTimes(1);
  });
});
