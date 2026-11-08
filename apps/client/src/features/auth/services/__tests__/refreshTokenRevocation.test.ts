/**
 * Server-side revocation of a refresh token the device drops (#942): a
 * best-effort, fire-and-forget POST /auth/logout that never wakes the
 * scale-to-zero backend through the wake wrapper, never shows the overlay,
 * is never retried and never throws.
 */
import {
  REVOKE_TIMEOUT_MS,
  revokeRefreshTokenInBackground,
} from "../refreshTokenRevocation";

const mockLogout = jest.fn();
const mockRawFetch = jest.fn();

jest.mock("../../../../api/generated", () => ({
  authControllerLogout: (...args: unknown[]) => mockLogout(...args) as unknown,
}));

jest.mock("../../../../utils/backendWake", () => ({
  rawFetch: () => mockRawFetch,
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

type LogoutOptions = {
  body: { refresh_token: string };
  signal: AbortSignal;
  fetch: unknown;
};
const lastOptions = (): LogoutOptions =>
  mockLogout.mock.calls[0][0] as LogoutOptions;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLogout.mockResolvedValue({ data: { success: true }, error: undefined });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("revokeRefreshTokenInBackground", () => {
  it("sends the refresh token to /auth/logout", () => {
    revokeRefreshTokenInBackground("refresh-1");

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(lastOptions().body).toEqual({ refresh_token: "refresh-1" });
  });

  it("bypasses the wake wrapper: raw fetch, no overlay, no replay", () => {
    revokeRefreshTokenInBackground("refresh-1");

    expect(lastOptions().fetch).toBe(mockRawFetch);
  });

  it("does nothing without a refresh token", () => {
    revokeRefreshTokenInBackground(undefined);
    revokeRefreshTokenInBackground("");

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("returns at once, without waiting for the server", () => {
    mockLogout.mockReturnValue(new Promise(() => undefined));

    const result: unknown = revokeRefreshTokenInBackground("refresh-1");

    expect(result).toBeUndefined();
  });

  it("aborts the request once the time limit is reached", async () => {
    jest.useFakeTimers();
    mockLogout.mockReturnValue(new Promise(() => undefined));

    revokeRefreshTokenInBackground("refresh-1");
    const { signal } = lastOptions();
    jest.advanceTimersByTime(REVOKE_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);

    expect(signal.aborted).toBe(true);
  });

  it("clears its timer once the server answered", async () => {
    jest.useFakeTimers();

    revokeRefreshTokenInBackground("refresh-1");
    await flush();

    expect(jest.getTimerCount()).toBe(0);
    expect(lastOptions().signal.aborted).toBe(false);
  });

  it("swallows a rejected request (offline, abort)", async () => {
    mockLogout.mockRejectedValue(new Error("Network request failed"));

    expect(() => revokeRefreshTokenInBackground("refresh-1")).not.toThrow();
    await flush();
  });

  it("swallows an error answer (token already revoked or expired)", async () => {
    mockLogout.mockResolvedValue({
      data: undefined,
      error: { message: "Invalid refresh token" },
    });

    expect(() => revokeRefreshTokenInBackground("refresh-1")).not.toThrow();
    await flush();
  });

  it("swallows a synchronous throw of the client", () => {
    mockLogout.mockImplementation(() => {
      throw new Error("client not configured");
    });

    expect(() => revokeRefreshTokenInBackground("refresh-1")).not.toThrow();
  });
});
