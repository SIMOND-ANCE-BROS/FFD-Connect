/**
 * Tests for the api axios instance.
 * Mocks config and dependencies so we can test interceptor behavior.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AxiosError } from "axios";
import api from "../api";

const mockWarn = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

jest.mock("../../config", () => ({
  API_URL: "http://test.local",
  API_TIMEOUT_MS: 30000,
  API_RETRY_MAX_RETRIES: 2,
  API_RETRY_INITIAL_DELAY_MS: 1000,
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]): void => {
      mockError(...args);
    },
    warn: (...args: unknown[]): void => {
      mockWarn(...args);
    },
    info: (...args: unknown[]): void => {
      mockInfo(...args);
    },
  }),
}));

// LogService mock removed as it is no longer used

const mockRetryAxios = jest.fn();
jest.mock("../../utils/retry", () => ({
  retryAxios: (fn: () => Promise<unknown>): Promise<unknown> =>
    mockRetryAxios(fn) as Promise<unknown>,
}));

const mockWakeBackend = jest.fn();
jest.mock("../../utils/backendWake", () => ({
  wakeBackend: (): Promise<boolean> => mockWakeBackend() as Promise<boolean>,
}));

const mockRefreshSession = jest.fn();
jest.mock("../../api/sessionRefresh", () => ({
  refreshSession: (): Promise<string | null> =>
    mockRefreshSession() as Promise<string | null>,
}));

const mockGetAccessToken = jest.fn();
jest.mock("../../api/tokenStore", () => ({
  getAccessToken: (): Promise<string | undefined> =>
    mockGetAccessToken() as Promise<string | undefined>,
}));

describe("api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockRetryAxios.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockRefreshSession.mockResolvedValue(null);
    mockGetAccessToken.mockResolvedValue(undefined);
    // Par défaut : réveil désactivé (comportement dev) → les chemins de retry
    // existants restent inchangés.
    mockWakeBackend.mockResolvedValue(false);
  });

  it("exports axios instance with expected methods", () => {
    expect(api).toBeDefined();

    expect(api.get).toBeDefined();

    expect(api.post).toBeDefined();

    expect(api.request).toBeDefined();
  });

  it("injects auth token from the token store when present", async () => {
    mockGetAccessToken.mockResolvedValue("test-token-123");

    const mockAdapter = jest.fn().mockResolvedValue({
      data: {},
      status: 200,
      config: { url: "/test", method: "get" },
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await api.get("/test");

    expect(mockAdapter).toHaveBeenCalled();
    const adapterConfig = mockAdapter.mock.calls[0][0];
    expect(adapterConfig.headers?.Authorization).toBe("Bearer test-token-123");

    api.defaults.adapter = originalAdapter;
  });

  it("continues without auth header when AsyncStorage has no token", async () => {
    const mockAdapter = jest.fn().mockResolvedValue({
      data: {},
      status: 200,
      config: { url: "/test", method: "get" },
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await api.get("/test");

    const adapterConfig = mockAdapter.mock.calls[0][0];
    expect(adapterConfig.headers?.Authorization).toBeUndefined();

    api.defaults.adapter = originalAdapter;
  });

  it("uses correct baseURL from config", () => {
    expect(api.defaults.baseURL).toBe("http://test.local");
  });

  it("has timeout configured", () => {
    expect(api.defaults.timeout).toBe(30000);
  });

  it("on 401 refreshes the token and retries the request once", async () => {
    mockRefreshSession.mockResolvedValue("new-token");

    const err401 = Object.assign(new Error("Unauthorized"), {
      response: { status: 401 },
      config: { url: "/tracks", method: "get" },
    }) as unknown as AxiosError;

    const mockAdapter = jest
      .fn()
      .mockRejectedValueOnce(err401)
      .mockResolvedValueOnce({
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: { url: "/tracks" },
      });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    const res = await api.get("/tracks");

    expect(res.data).toEqual({ ok: true });
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockAdapter).toHaveBeenCalledTimes(2);

    api.defaults.adapter = originalAdapter;
  });

  it("on 401 for auth/login does not clear token to avoid cycles", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        authToken: "bad-token",
        isLoggedIn: true,
      }),
    );

    const err401 = Object.assign(new Error("Invalid credentials"), {
      response: { status: 401 },
      config: { url: "/auth/login", method: "post" },
    }) as unknown as AxiosError;

    const mockAdapter = jest.fn().mockRejectedValue(err401);
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await expect(api.post("/auth/login", {})).rejects.toEqual(err401);

    expect(mockWarn).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("on 4xx error rejects without retry", async () => {
    const err404 = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
      config: { url: "/tracks/missing", method: "get", _retry: false },
    }) as unknown as AxiosError;

    const mockAdapter = jest.fn().mockRejectedValue(err404);
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await expect(api.get("/tracks/missing")).rejects.toEqual(err404);

    expect(mockRetryAxios).not.toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("on network error triggers retry", async () => {
    const networkErr = Object.assign(new Error("Network Error"), {
      response: undefined,
      config: {
        url: "/health",
        method: "get",
        _retry: false,
      },
    }) as unknown as AxiosError;

    let callCount = 0;
    const mockAdapter = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(networkErr);
      }
      return Promise.resolve({
        data: { status: "ok" },
        status: 200,
        config: { url: "/health", method: "get" },
      });
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    mockRetryAxios.mockImplementation(async (fn: () => Promise<unknown>) => {
      return fn();
    });

    const res = await api.get("/health");

    expect(mockRetryAxios).toHaveBeenCalled();
    expect(res.data).toEqual({ status: "ok" });

    api.defaults.adapter = originalAdapter;
  });

  it("on 5xx error triggers retry and succeeds", async () => {
    const err503 = Object.assign(new Error("Service Unavailable"), {
      response: { status: 503 },
      config: { url: "/tracks", method: "get", _retry: false },
    }) as unknown as AxiosError;

    let callCount = 0;
    const mockAdapter = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(err503);
      }
      return Promise.resolve({
        data: [{ id: "1" }],
        status: 200,
        config: { url: "/tracks", method: "get" },
      });
    });

    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    mockRetryAxios.mockImplementation((fn: () => Promise<unknown>) => fn());

    const res = await api.get("/tracks");

    expect(mockRetryAxios).toHaveBeenCalled();
    expect(res.data).toEqual([{ id: "1" }]);

    api.defaults.adapter = originalAdapter;
  });

  it("on 5xx error retry fails and rejects", async () => {
    const err503 = Object.assign(new Error("Service Unavailable"), {
      response: { status: 503 },
      config: { url: "/tracks", method: "get", _retry: false },
    }) as unknown as AxiosError;

    const mockAdapter = jest.fn().mockRejectedValue(err503);
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    mockRetryAxios.mockRejectedValue(err503);

    await expect(api.get("/tracks")).rejects.toEqual(err503);

    expect(mockRetryAxios).toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("on 401 rejects when the silent refresh fails", async () => {
    mockRefreshSession.mockResolvedValue(null);

    const err401 = Object.assign(new Error("Unauthorized"), {
      response: { status: 401 },
      config: { url: "/users/me", method: "get" },
    }) as unknown as AxiosError;

    const mockAdapter = jest.fn().mockRejectedValue(err401);
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await expect(api.get("/users/me")).rejects.toEqual(err401);

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);

    api.defaults.adapter = originalAdapter;
  });

  it("on 401 for auth/forgot-password does not clear token", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ authToken: "token", isLoggedIn: true }),
    );

    const err401 = Object.assign(new Error("Invalid"), {
      response: { status: 401 },
      config: { url: "/auth/forgot-password", method: "post" },
    }) as unknown as AxiosError;

    const mockAdapter = jest.fn().mockRejectedValue(err401);
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await expect(api.post("/auth/forgot-password", {})).rejects.toEqual(err401);

    expect(mockWarn).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("on network error wakes the backend and replays once (no fast retry)", async () => {
    mockWakeBackend.mockResolvedValue(true);

    const networkErr = Object.assign(new Error("Network request failed"), {
      response: undefined,
      config: { url: "/licenses/me", method: "get" },
    }) as unknown as AxiosError;

    let callCount = 0;
    const mockAdapter = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(networkErr);
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        config: { url: "/licenses/me", method: "get" },
      });
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    const res = await api.get("/licenses/me");

    expect(res.data).toEqual({ ok: true });
    expect(mockWakeBackend).toHaveBeenCalledTimes(1);
    expect(mockAdapter).toHaveBeenCalledTimes(2); // original + replay
    expect(mockRetryAxios).not.toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("on 503 wakes the backend and replays once", async () => {
    mockWakeBackend.mockResolvedValue(true);

    const err503 = Object.assign(new Error("Service Unavailable"), {
      response: { status: 503 },
      config: { url: "/competitions", method: "get" },
    }) as unknown as AxiosError;

    let callCount = 0;
    const mockAdapter = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(err503);
      return Promise.resolve({
        data: [{ id: "1" }],
        status: 200,
        config: { url: "/competitions", method: "get" },
      });
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    const res = await api.get("/competitions");

    expect(res.data).toEqual([{ id: "1" }]);
    expect(mockWakeBackend).toHaveBeenCalledTimes(1);
    expect(mockRetryAxios).not.toHaveBeenCalled();

    api.defaults.adapter = originalAdapter;
  });

  it("falls back to the classic retry when the wake declines (disabled)", async () => {
    mockWakeBackend.mockResolvedValue(false);

    const networkErr = Object.assign(new Error("Network Error"), {
      response: undefined,
      config: { url: "/health", method: "get" },
    }) as unknown as AxiosError;

    let callCount = 0;
    const mockAdapter = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(networkErr);
      return Promise.resolve({
        data: { status: "ok" },
        status: 200,
        config: { url: "/health", method: "get" },
      });
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    const res = await api.get("/health");

    expect(mockWakeBackend).toHaveBeenCalledTimes(1);
    expect(mockRetryAxios).toHaveBeenCalled(); // le retry classique a pris le relais
    expect(res.data).toEqual({ status: "ok" });

    api.defaults.adapter = originalAdapter;
  });

  it("proceeds without auth header and logs when token retrieval throws", async () => {
    mockGetAccessToken.mockRejectedValue(new Error("secure store error"));

    const mockAdapter = jest.fn().mockResolvedValue({
      data: {},
      status: 200,
      config: { url: "/test", method: "get" },
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = mockAdapter;

    await api.get("/test");

    expect(mockAdapter).toHaveBeenCalled();
    const adapterConfig = mockAdapter.mock.calls[0][0];
    expect(adapterConfig.headers?.Authorization).toBeUndefined();
    expect(mockError).toHaveBeenCalledWith(
      "Error retrieving auth token",
      expect.any(Error),
    );

    api.defaults.adapter = originalAdapter;
  });
});
