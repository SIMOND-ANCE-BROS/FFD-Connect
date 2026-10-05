import { analytics } from "../AnalyticsService";

describe("AnalyticsService", () => {
  it("exposes logEvent and logScreenView", () => {
    expect(analytics.logEvent).toBeDefined();
    expect(analytics.logScreenView).toBeDefined();
    expect(typeof analytics.logEvent).toBe("function");
    expect(typeof analytics.logScreenView).toBe("function");
  });

  it("logEvent does not throw", () => {
    expect(() =>
      analytics.logEvent("login", { method: "email" }),
    ).not.toThrow();
    expect(() => analytics.logEvent("screen_view")).not.toThrow();
  });

  it("logScreenView does not throw", () => {
    expect(() => analytics.logScreenView("Login")).not.toThrow();
    expect(() =>
      analytics.logScreenView("CompetitionDetail", { competition_id: "id-1" }),
    ).not.toThrow();
  });
});
