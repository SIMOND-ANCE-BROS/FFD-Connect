import {
  createDefaultConfig,
  createRound,
  DANCES,
  usePerformanceStore,
} from "../performance.store";

describe("performance.store", () => {
  it("defaults to one Latin Passage round with 2 heats and all dances", () => {
    const { config } = usePerformanceStore.getState();
    expect(config.rounds).toHaveLength(1);
    expect(config.rounds[0]).toMatchObject({
      category: "Latin",
      type: "Round",
      heats: 2,
      selectedDances: [...DANCES.Latin],
    });
    expect(config).toMatchObject({
      duration: 90,
      pauseDuration: 15,
      pasoClashes: 2,
    });
  });

  it("creates rounds with unique ids and Final = 1 heat", () => {
    const a = createRound("Standard", "Final");
    const b = createRound("Standard", "Final");
    expect(a.id).not.toBe(b.id);
    expect(a.heats).toBe(1);
    expect(a.selectedDances).toEqual([...DANCES.Standard]);
  });

  it("returns fresh default configs (no shared mutable state)", () => {
    const a = createDefaultConfig();
    a.rounds[0].selectedDances.pop();
    expect(createDefaultConfig().rounds[0].selectedDances).toHaveLength(5);
  });

  it("exposes loading progress and announcing setters", () => {
    const s = usePerformanceStore.getState();
    s.setLoadingProgress({ done: 2, total: 9 });
    s.setIsAnnouncing(true);
    expect(usePerformanceStore.getState().loadingProgress).toEqual({
      done: 2,
      total: 9,
    });
    expect(usePerformanceStore.getState().isAnnouncing).toBe(true);
    s.setLoadingProgress(null);
    s.setIsAnnouncing(false);
  });

  it("accepts updater functions for config and time", () => {
    const s = usePerformanceStore.getState();
    s.setConfig((prev) => ({ ...prev, duration: 60 }));
    s.setTimeRemaining(10);
    s.setTimeRemaining((t) => t - 1);
    expect(usePerformanceStore.getState().config.duration).toBe(60);
    expect(usePerformanceStore.getState().timeRemaining).toBe(9);
  });
});
