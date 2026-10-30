/**
 * #893 — a request started under one identity never goes out again under
 * another. Every retry/replay of the axios instance (wake, 401, 429,
 * network/5xx) re-reads the token; after a login, a logout, an expired
 * session or either end of a support access, it must be cancelled instead,
 * and never fall back to the offline queue.
 */
import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import api from "../api";
import { submitRegistrationAction } from "../../features/competitions/services/registrationQueue";
import { enqueueMutation } from "../offlineQueueStorage";

jest.mock("../../config", () => ({
  API_URL: "http://test.local",
  API_TIMEOUT_MS: 30000,
  API_RETRY_MAX_RETRIES: 2,
  API_RETRY_INITIAL_DELAY_MS: 1,
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));

const mockWakeBackend = jest.fn<Promise<boolean>, []>();
jest.mock("../../utils/backendWake", () => ({
  wakeBackend: () => mockWakeBackend(),
}));

const mockRefreshSession = jest.fn<Promise<string | null>, []>();
jest.mock("../../api/sessionRefresh", () => ({
  refreshSession: () => mockRefreshSession(),
}));

let mockGeneration = 0;
const mockGetAccessToken = jest.fn<Promise<string | undefined>, []>();
jest.mock("../../api/tokenStore", () => ({
  getAccessToken: () => mockGetAccessToken(),
  getSessionGeneration: () => mockGeneration,
}));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
  },
}));

jest.mock("../offlineQueueStorage", () => ({
  enqueueMutation: jest.fn(async () => "enqueued"),
}));

/** The admin starts a support access on B (or anyone logs in/out). */
function identityChanges(): void {
  mockGeneration += 1;
}

function failWith(
  config: InternalAxiosRequestConfig,
  status?: number,
  headers: Record<string, string> = {},
): Promise<never> {
  return Promise.reject(
    Object.assign(new Error(status ? `HTTP ${status}` : "Network Error"), {
      isAxiosError: true,
      config,
      response: status ? { status, headers, data: {}, config } : undefined,
    }),
  );
}

const ok = (config: InternalAxiosRequestConfig): AxiosResponse => ({
  data: { ok: true },
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

let adapter: jest.Mock<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>;
const originalAdapter = api.defaults.adapter;

/** Authorization headers the backend actually received, in order. */
const sentTokens = () =>
  adapter.mock.calls.map(([config]) => config.headers.Authorization as unknown);

async function expectCancelled(request: Promise<unknown>): Promise<void> {
  const error: unknown = await request.catch((e: unknown) => e);
  expect(axios.isCancel(error)).toBe(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration = 0;
  // Token of whoever the app currently speaks for.
  mockGetAccessToken.mockImplementation(async () =>
    mockGeneration === 0 ? "token-A" : "token-B",
  );
  mockWakeBackend.mockResolvedValue(false);
  mockRefreshSession.mockResolvedValue(null);
  adapter = jest.fn((config: InternalAxiosRequestConfig) =>
    Promise.resolve(ok(config)),
  );
  api.defaults.adapter = adapter;
});

afterAll(() => {
  api.defaults.adapter = originalAdapter;
});

describe("retries never cross an identity change (#893)", () => {
  it("wake replay: cancelled when the identity changed during the wake", async () => {
    adapter.mockImplementationOnce((config) => failWith(config));
    mockWakeBackend.mockImplementation(async () => {
      identityChanges();
      return true;
    });

    await expectCancelled(api.post("/competitions/c1/register", {}));

    expect(sentTokens()).toEqual(["Bearer token-A"]);
  });

  it("wake replay: still sent when the identity did not change", async () => {
    adapter.mockImplementationOnce((config) => failWith(config, 503));
    mockWakeBackend.mockResolvedValue(true);

    await expect(api.get("/tracks")).resolves.toMatchObject({ status: 200 });

    expect(sentTokens()).toEqual(["Bearer token-A", "Bearer token-A"]);
  });

  it("401 replay: cancelled when the identity changed during the refresh", async () => {
    adapter.mockImplementationOnce((config) => failWith(config, 401));
    mockRefreshSession.mockImplementation(async () => {
      identityChanges();
      return "token-B";
    });

    await expectCancelled(api.post("/competitions/c1/register", {}));

    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("429 retry: cancelled when the identity changed during Retry-After", async () => {
    adapter.mockImplementationOnce((config) => {
      identityChanges();
      return failWith(config, 429, { "retry-after": "0" });
    });

    await expectCancelled(api.post("/competitions/c1/register", {}));

    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("network retry: cancelled, and not retried again", async () => {
    adapter.mockImplementationOnce((config) => failWith(config));
    // The wake declines (disabled), but the identity changed meanwhile.
    mockWakeBackend.mockImplementation(async () => {
      identityChanges();
      return false;
    });

    await expectCancelled(api.post("/competitions/c1/register", {}));

    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("5xx retry: cancelled, and not retried again", async () => {
    adapter.mockImplementationOnce((config) => {
      identityChanges();
      return failWith(config, 500);
    });

    await expectCancelled(api.post("/competitions/c1/register", {}));

    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("first dispatch: a token read straddling a switch is never sent", async () => {
    mockGetAccessToken.mockImplementationOnce(async () => {
      identityChanges();
      return "token-B";
    });

    await expectCancelled(api.get("/users/me"));

    expect(adapter).not.toHaveBeenCalled();
    expect(mockWakeBackend).not.toHaveBeenCalled();
  });

  it("a new request after the switch goes out normally, as the new identity", async () => {
    identityChanges();

    await api.get("/users/me");

    expect(sentTokens()).toEqual(["Bearer token-B"]);
  });
});

describe("offline-queue fallback (#893)", () => {
  it("a registration cancelled by an identity change is not queued for replay", async () => {
    adapter.mockImplementationOnce((config) => failWith(config));
    mockWakeBackend.mockImplementation(async () => {
      identityChanges();
      return true;
    });

    const outcome = submitRegistrationAction(
      "register",
      { competitionId: "c1", eventId: "e1", partnerName: "A's partner" },
      () => api.post("/competitions/c1/register", { eventId: "e1" }),
      [],
    );

    await expectCancelled(outcome);
    expect(enqueueMutation).not.toHaveBeenCalled();
  });

  it("a plain network error is still queued (control)", async () => {
    adapter.mockImplementation((config) => failWith(config));

    const outcome = await submitRegistrationAction(
      "register",
      { competitionId: "c1", eventId: "e1" },
      () => api.post("/competitions/c1/register", { eventId: "e1" }),
      [],
    );

    expect(outcome).toEqual({ status: "queued" });
    expect(enqueueMutation).toHaveBeenCalledTimes(1);
  });
});
