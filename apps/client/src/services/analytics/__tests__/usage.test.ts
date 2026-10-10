import { AppState } from "react-native";

const mockRawFetch = jest.fn();
jest.mock("../../../utils/backendWake", () => ({
  rawFetch: () => mockRawFetch,
}));

import { sendUsageBatch, usage } from "../usage";

describe("usage context", () => {
  it("derives the space and the store-review flag from the auth config", () => {
    expect(
      usage.contextFromConfig({ isLoggedIn: false, role: "LICENSEE" }),
    ).toEqual({ space: "GUEST", storeReview: false });
    expect(
      usage.contextFromConfig({
        isLoggedIn: true,
        isGuest: true,
        role: "LICENSEE",
      }),
    ).toEqual({ space: "GUEST", storeReview: false });
    expect(
      usage.contextFromConfig({
        isLoggedIn: true,
        role: "CLUB",
        isStoreReview: true,
      }),
    ).toEqual({ space: "CLUB", storeReview: true });
  });
});

describe("sendUsageBatch", () => {
  const realFetch = global.fetch;
  beforeEach(() => mockRawFetch.mockReset());
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it("bypasses the global fetch (backendWake wrapper): a failure can never wake the backend", async () => {
    const globalFetch = jest.fn();
    global.fetch = globalFetch;
    mockRawFetch.mockResolvedValue({ status: 503 });
    await expect(sendUsageBatch([])).resolves.toBe(503);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(mockRawFetch).toHaveBeenCalledTimes(1);
  });

  it("POSTs JSON without any Authorization header and returns the status", async () => {
    mockRawFetch.mockResolvedValue({ status: 204 });
    await expect(sendUsageBatch([])).resolves.toBe(204);
    const [url, init] = mockRawFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/analytics\/events$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ events: [] }));
  });

  it("gives up after 10 s (aborted, resolves 0)", async () => {
    jest.useFakeTimers();
    mockRawFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const pending = sendUsageBatch([]);
    jest.advanceTimersByTime(10_000);
    await expect(pending).resolves.toBe(0);
  });

  it("resolves 0 on a network error", async () => {
    mockRawFetch.mockRejectedValue(new Error("offline"));
    await expect(sendUsageBatch([])).resolves.toBe(0);
  });
});

describe("usage.start", () => {
  it("records the closing screen view BEFORE the background flush", async () => {
    let handler: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, cb) => {
      handler = cb as (s: string) => void;
      return { remove: jest.fn() };
    });
    const order: string[] = [];
    const flush = jest
      .spyOn(usage.recorder, "onBackground")
      .mockImplementation(async () => {
        order.push("flush");
      });
    const stop = usage.start(async () => {
      await Promise.resolve();
      order.push("screen recorded");
    });
    handler?.("background");
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(["screen recorded", "flush"]);
    stop();
    flush.mockRestore();
  });
});
