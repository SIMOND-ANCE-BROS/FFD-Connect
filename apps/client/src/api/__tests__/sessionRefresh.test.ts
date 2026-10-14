import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { refreshSession } from "../sessionRefresh";
import { TokenStoreUnavailableError } from "../tokenStoreErrors";

const mockRefreshAuth = jest.fn();
const mockGetTokens = jest.fn();
const mockSetTokens = jest.fn();
const mockClearTokens = jest.fn();
const mockClearLicenseSnapshot = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn() },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
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
  setTokens: (t: unknown) => mockSetTokens(t),
  clearTokens: () => mockClearTokens(),
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
  mockSetTokens.mockResolvedValue(undefined);
  mockClearTokens.mockResolvedValue(undefined);
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
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved.isLoggedIn).toBe(false);
  });

  it("refreshes and persists the new access + rotated refresh token", async () => {
    mockGetTokens.mockResolvedValue({ refreshToken: "r1" });
    post.mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "r2" },
    });

    await expect(refreshSession()).resolves.toBe("new-access");

    expect(mockSetTokens).toHaveBeenCalledWith({
      authToken: "new-access",
      refreshToken: "r2",
    });
    const saved = JSON.parse(setItem.mock.calls[0][1] as string);
    expect(saved.isLoggedIn).toBe(true);
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
