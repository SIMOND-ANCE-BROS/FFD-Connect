import {
  createUsageRecorder,
  USAGE_KEYS,
  uuidV4,
  type UsageDeps,
  type UsageRecord,
} from "../usageRecorder";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      map.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      map.delete(k);
    }),
  };
}

function setup(o: Partial<UsageDeps> = {}) {
  const storage = memoryStorage();
  let clock = new Date("2026-10-10T08:15:42.000Z");
  const sent: UsageRecord[][] = [];
  const send = jest.fn(async (events: UsageRecord[]) => {
    sent.push(events);
    return 204;
  });
  const deps: UsageDeps = {
    storage,
    now: () => clock,
    random: Math.random,
    platform: "ios",
    appVersion: "1.4.2",
    context: () => ({ space: "LICENSEE", storeReview: false }),
    send,
    ...o,
  };
  const recorder = createUsageRecorder(deps);
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const buffer = () =>
    JSON.parse(storage.map.get(USAGE_KEYS.buffer) ?? "[]") as UsageRecord[];
  return {
    recorder,
    storage,
    send: deps.send as jest.Mock,
    sent,
    advance,
    buffer,
  };
}

describe("uuidV4", () => {
  it("produces RFC 4122 v4 UUIDs", () => {
    expect(uuidV4(Math.random)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("usageRecorder", () => {
  it("records whitelisted fields only, minute precision, context space", async () => {
    const { recorder, buffer } = setup();
    await recorder.record({
      name: "competition_view",
      competitionId: "00000000-0000-4000-8000-000000000000",
      screen: "CompetitionDetail",
    });
    expect(buffer()[0]).toEqual({
      installId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "competition_view",
      screen: "CompetitionDetail",
      occurredAt: "2026-10-10T08:15:00.000Z",
      platform: "ios",
      appVersion: "1.4.2",
      space: "LICENSEE",
      competitionId: "00000000-0000-4000-8000-000000000000",
    });
  });

  it("drops a competitionId that is not a UUID and caps the duration", async () => {
    const { recorder, buffer } = setup();
    await recorder.record({
      name: "screen_view",
      screen: "Home",
      competitionId: "42",
      durationSec: 5000,
    });
    expect(buffer()[0].competitionId).toBeUndefined();
    expect(buffer()[0].durationSec).toBe(1800);
  });

  it("keeps the newest 500 events", async () => {
    const { recorder, buffer, advance } = setup();
    for (let i = 0; i < 502; i++) {
      advance(60_000);
      await recorder.record({ name: "login" });
    }
    const b = buffer();
    expect(b).toHaveLength(500);
    expect(b[0].occurredAt).toBe("2026-10-10T08:18:00.000Z"); // first two (08:16, 08:17) dropped
  });

  it("keeps the install ID within a month and renews it the next month", async () => {
    const { recorder, buffer, advance } = setup();
    await recorder.record({ name: "login" });
    advance(86_400_000);
    await recorder.record({ name: "login" });
    advance(30 * 86_400_000); // November
    await recorder.record({ name: "login" });
    const [a, b, c] = buffer();
    expect(a.installId).toBe(b.installId);
    expect(c.installId).not.toBe(a.installId);
  });

  it("records nothing without a platform (web) or for a store-review session", async () => {
    const web = setup({ platform: null });
    await web.recorder.record({ name: "login" });
    expect(web.buffer()).toHaveLength(0);
    const review = setup({
      context: () => ({ space: "LICENSEE", storeReview: true }),
    });
    await review.recorder.record({ name: "login" });
    expect(review.buffer()).toHaveLength(0);
  });

  it("recording never sends; a successful API response does, at most every 2 minutes", async () => {
    const { recorder, send, advance } = setup();
    await recorder.record({ name: "login" });
    expect(send).not.toHaveBeenCalled();
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(1);
    await recorder.record({ name: "login" });
    advance(60_000);
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(1); // < 2 min since the last flush
    advance(61_000);
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("background send only with an API success in the last 2 minutes", async () => {
    const { recorder, send, advance } = setup();
    await recorder.record({ name: "login" });
    await recorder.onBackground();
    expect(send).not.toHaveBeenCalled(); // backend may be asleep
    await recorder.onApiSuccess(); // flush #1
    await recorder.record({ name: "login" });
    advance(90_000);
    await recorder.onBackground(); // flush #2 (within 2 min of the success)
    await recorder.record({ name: "login" });
    advance(60_000); // 2.5 min since the last success: the app may be scaling down
    await recorder.onBackground(); // no flush
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends at most 200 per batch and removes only what was sent", async () => {
    const { recorder, sent, buffer, advance } = setup();
    for (let i = 0; i < 250; i++) await recorder.record({ name: "login" });
    await recorder.onApiSuccess();
    expect(sent[0]).toHaveLength(200);
    expect(buffer()).toHaveLength(50);
    advance(121_000);
    await recorder.onApiSuccess();
    expect(buffer()).toHaveLength(0);
  });

  it.each([0, 500, 503, 429])(
    "keeps the batch when the send fails with %p",
    async (status) => {
      const { recorder, buffer } = setup({ send: jest.fn(async () => status) });
      await recorder.record({ name: "login" });
      await recorder.onApiSuccess();
      expect(buffer()).toHaveLength(1);
    },
  );

  it("drops the batch on 400 (invalid data never loops)", async () => {
    const { recorder, buffer } = setup({ send: jest.fn(async () => 400) });
    await recorder.record({ name: "login" });
    await recorder.onApiSuccess();
    expect(buffer()).toHaveLength(0);
  });

  it("opt-out clears buffer and ID and stops recording; opt-in draws a new ID", async () => {
    const { recorder, storage, buffer } = setup();
    await recorder.record({ name: "login" });
    const firstId = buffer()[0].installId;
    await recorder.setEnabled(false);
    expect(storage.map.has(USAGE_KEYS.buffer)).toBe(false);
    expect(storage.map.has(USAGE_KEYS.install)).toBe(false);
    expect(await recorder.isEnabled()).toBe(false);
    await recorder.record({ name: "login" });
    expect(buffer()).toHaveLength(0);
    await recorder.setEnabled(true);
    await recorder.record({ name: "login" });
    expect(buffer()[0].installId).not.toBe(firstId);
  });

  it("an empty buffer sends nothing", async () => {
    const { recorder, send } = setup();
    await recorder.onApiSuccess();
    expect(send).not.toHaveBeenCalled();
  });

  it("never sends an event the server would reject as too old (it would poison the batch)", async () => {
    const { recorder, sent, buffer } = setup();
    await recorder.record({
      name: "screen_view",
      screen: "Home",
      occurredAt: new Date("2026-10-03T20:00:00.000Z"), // ~6.5 days before the clock
    });
    await recorder.record({ name: "login" });
    await recorder.onApiSuccess();
    expect(sent[0].map((e) => e.name)).toEqual(["login"]);
    expect(buffer()).toHaveLength(0);
  });
});
