import { sendUsageBatch, usage } from "../usage";

describe("usage context", () => {
  it("derives the space and the store-review flag from the auth config", () => {
    expect(
      usage.contextFromConfig({ isLoggedIn: false, role: "LICENSEE" }),
    ).toEqual({
      space: "GUEST",
      storeReview: false,
    });
    expect(
      usage.contextFromConfig({
        isLoggedIn: true,
        isGuest: true,
        role: "LICENSEE",
      }),
    ).toEqual({
      space: "GUEST",
      storeReview: false,
    });
    expect(
      usage.contextFromConfig({
        isLoggedIn: true,
        role: "CLUB",
        isStoreReview: true,
      }),
    ).toEqual({
      space: "CLUB",
      storeReview: true,
    });
  });
});

describe("sendUsageBatch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("POSTs JSON without any Authorization header and returns the status", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 204 });
    global.fetch = fetchMock;
    await expect(sendUsageBatch([])).resolves.toBe(204);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/analytics\/events$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ events: [] }));
  });

  it("resolves 0 on a network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    await expect(sendUsageBatch([])).resolves.toBe(0);
  });
});
