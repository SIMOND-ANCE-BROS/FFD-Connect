import { createAnalytics } from "../AnalyticsService";
import type { UsageInput } from "../usageRecorder";

function setup(dev = false) {
  const recorded: UsageInput[] = [];
  let now = new Date("2026-10-10T08:00:00Z");
  const analytics = createAnalytics({
    dev,
    now: () => now,
    record: async (input) => {
      recorded.push(input);
    },
  });
  const advance = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  return { analytics, recorded, advance };
}

describe("AnalyticsService", () => {
  it("records events with their competition id only", () => {
    const { analytics, recorded } = setup();
    analytics.logEvent("competition_view", {
      competition_id: "00000000-0000-4000-8000-000000000000",
      screen_name: "X",
    });
    analytics.logEvent("login", { method: "email" });
    expect(recorded).toEqual([
      {
        name: "competition_view",
        competitionId: "00000000-0000-4000-8000-000000000000",
      },
      { name: "login" },
    ]);
  });

  it("records a screen view when it ends, with its start time and duration", () => {
    const { analytics, recorded, advance } = setup();
    analytics.logScreenView("Home");
    expect(recorded).toHaveLength(0);
    advance(42);
    analytics.logScreenView("Competitions");
    expect(recorded).toEqual([
      {
        name: "screen_view",
        screen: "Home",
        occurredAt: new Date("2026-10-10T08:00:00Z"),
        durationSec: 42,
      },
    ]);
    advance(10);
    analytics.endScreen();
    expect(recorded[1]).toMatchObject({
      name: "screen_view",
      screen: "Competitions",
      durationSec: 10,
    });
    analytics.endScreen(); // nothing pending
    expect(recorded).toHaveLength(2);
  });

  it("in dev, logs only and records nothing", () => {
    const { analytics, recorded } = setup(true);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    analytics.logEvent("login", { method: "email" });
    analytics.logScreenView("Home");
    analytics.endScreen();
    expect(recorded).toHaveLength(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
