import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import { useLiveResultsLogic } from "../useLiveResultsLogic";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../../context/CompetitionContext", () => ({
  useCompetitionRepository: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Result factory */
const makeResult = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "result-1",
  round: "Finale",
  ranking: 1,
  event: { category: "Standard", level: "D" },
  ...overrides,
});

// ─── Shared mock function references ──────────────────────────────────────────

const mockGetResults = jest.fn();

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("useLiveResultsLogic", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    jest.mocked(useCompetitionRepository).mockReturnValue({
      getResults: mockGetResults,
      // Satisfy the full CompetitionRepository interface with no-op stubs
      syncCompetitions: jest.fn(),
      getCompetitionDetails: jest.fn(),
      getCompetitionDetailsForUser: jest.fn(),
      registerForEvent: jest.fn(),
      getEventRegistrations: jest.fn(),
      unregisterFromEvent: jest.fn(),
      getUserRegistrations: jest.fn(),
      getCompetitions: jest.fn(),
      getClubPendingRegistrations: jest.fn(),
      registerMember: jest.fn(),
      confirmRegistration: jest.fn(),
      unregisterMember: jest.fn(),
    });

    mockGetResults.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ── 1. Returns empty sections when there are no results ─────────────────────

  it("returns empty sections array when no results are available", async () => {
    mockGetResults.mockResolvedValue([]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => {
      expect(result.current.state.refreshing).toBe(false);
    });

    expect(result.current.state.sections).toHaveLength(0);
  });

  // ── 2. Groups results by round into sections ─────────────────────────────────

  it("groups results by round into separate sections", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ id: "r1", round: "Finale", ranking: 1 }),
      makeResult({ id: "r2", round: "Finale", ranking: 2 }),
      makeResult({ id: "r3", round: "Demi-finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const sections = result.current.state.sections;
    expect(sections).toHaveLength(2);

    const finaleSection = sections.find((s) => s.title === "Finale");
    const demiSection = sections.find((s) => s.title === "Demi-finale");

    expect(finaleSection?.data).toHaveLength(2);
    expect(demiSection?.data).toHaveLength(1);
  });

  // ── 3. Each section sorted by ranking ascending ──────────────────────────────

  it("sorts results within each section by ranking ascending", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ id: "r3", round: "Finale", ranking: 3 }),
      makeResult({ id: "r1", round: "Finale", ranking: 1 }),
      makeResult({ id: "r2", round: "Finale", ranking: 2 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const finaleData = result.current.state.sections[0].data;
    expect(finaleData[0].ranking).toBe(1);
    expect(finaleData[1].ranking).toBe(2);
    expect(finaleData[2].ranking).toBe(3);
  });

  // ── 4. Finals appear before Semifinals in sections (priority ordering) ────────

  it("orders Finale section before Demi-finale section", async () => {
    // Provide in reverse priority order to verify sorting is applied
    mockGetResults.mockResolvedValue([
      makeResult({ id: "r2", round: "Demi-finale", ranking: 1 }),
      makeResult({ id: "r1", round: "Finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const sections = result.current.state.sections;
    expect(sections[0].title).toBe("Finale");
    expect(sections[1].title).toBe("Demi-finale");
  });

  // ── 5. Unknown round gets lowest priority and appears last ────────────────────

  it("places an unknown round after all known rounds", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ id: "r3", round: "Tour inconnu", ranking: 1 }),
      makeResult({ id: "r1", round: "Finale", ranking: 1 }),
      makeResult({ id: "r2", round: "Demi-finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const sections = result.current.state.sections;
    expect(sections[sections.length - 1].title).toBe("Tour inconnu");
  });

  // ── 6. Auto-refresh triggered after 30 seconds ──────────────────────────────

  it("calls getResults again after 30 seconds", async () => {
    mockGetResults.mockResolvedValue([]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const callsAfterMount = mockGetResults.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    await waitFor(() => {
      expect(mockGetResults.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
  });

  // ── 7. Interval cleared on unmount ───────────────────────────────────────────

  it("stops auto-refresh after unmount", async () => {
    mockGetResults.mockResolvedValue([]);

    const { result, unmount } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    await unmount();

    const callsBeforeAdvance = mockGetResults.mock.calls.length;

    await act(() => {
      jest.advanceTimersByTime(30000);
    });

    // No additional calls after unmount
    expect(mockGetResults.mock.calls.length).toBe(callsBeforeAdvance);
  });

  // ── 8. Section title matches the round name ──────────────────────────────────

  it("uses the round string as the section title", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ round: "Quart de finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    expect(result.current.state.sections[0].title).toBe("Quart de finale");
  });

  // ── 9. Multiple rounds grouped correctly with correct data lengths ────────────

  it("correctly groups results across multiple distinct rounds", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ id: "a", round: "Finale", ranking: 1 }),
      makeResult({ id: "b", round: "Demi-finale", ranking: 1 }),
      makeResult({ id: "c", round: "Demi-finale", ranking: 2 }),
      makeResult({ id: "d", round: "Quart de finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const sections = result.current.state.sections;
    expect(sections).toHaveLength(3);

    const demi = sections.find((s) => s.title === "Demi-finale");
    expect(demi?.data).toHaveLength(2);
  });

  // ── 10. refreshing is true while fetch is in-flight ─────────────────────────

  it("sets refreshing=true while getResults is pending", async () => {
    // Never resolves during synchronous check
    mockGetResults.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    expect(result.current.state.refreshing).toBe(true);
  });

  // ── 11. eventLabel built from first result's event category and level ────────

  it("builds eventLabel from the first result when sections are populated", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({
        round: "Finale",
        ranking: 1,
        event: { category: "Standard", level: "D" },
      }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    expect(result.current.state.eventLabel).toBe("STANDARD - D");
  });

  it("falls back to the ageGroup when the event has no level (no 'UNDEFINED')", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({
        eventId: "ev-latin",
        event: { category: "Latin", ageGroup: "Adult" },
      }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    expect(result.current.state.eventLabel).toBe("LATIN - ADULT");
  });

  it("leaves eventLabel empty when results span several events", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({
        id: "r1",
        eventId: "ev-latin",
        round: "Latines — Finale",
        event: { category: "Latin", ageGroup: "Adult" },
      }),
      makeResult({
        id: "r2",
        eventId: "ev-std",
        round: "Standard — Demi-finale",
        event: { category: "Standard", ageGroup: "Adult" },
      }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    expect(result.current.state.sections).toHaveLength(2);
    expect(result.current.state.eventLabel).toBe("");
  });

  // ── 12. loadResults action re-fetches results on demand ─────────────────────

  it("re-fetches results when loadResults action is called manually", async () => {
    mockGetResults.mockResolvedValue([]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const callsAfterMount = mockGetResults.mock.calls.length;

    await act(async () => {
      await result.current.actions.loadResults();
    });

    expect(mockGetResults.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  // ── 13. Handles errors gracefully leaving sections empty ─────────────────────

  it("leaves sections empty and stops refreshing when getResults rejects", async () => {
    mockGetResults.mockRejectedValue(new Error("Network error"));

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    expect(result.current.state.sections).toHaveLength(0);
  });

  // ── 14. Full round priority ordering across all known round types ─────────────

  it("orders sections: Finale > Demi > Quart > 8e > 16e > unknown", async () => {
    mockGetResults.mockResolvedValue([
      makeResult({ id: "u", round: "Tour préliminaire", ranking: 1 }),
      makeResult({ id: "16", round: "16e de finale", ranking: 1 }),
      makeResult({ id: "8", round: "8e de finale", ranking: 1 }),
      makeResult({ id: "q", round: "Quarts de finale", ranking: 1 }),
      makeResult({ id: "d", round: "Demi-finales", ranking: 1 }),
      makeResult({ id: "f", round: "Finale", ranking: 1 }),
    ]);

    const { result } = await renderHook(() =>
      useLiveResultsLogic({ competitionId: "comp-1" }),
    );

    await waitFor(() => expect(result.current.state.refreshing).toBe(false));

    const titles = result.current.state.sections.map((s) => s.title);

    // "final" keyword → priority 0, must come first
    expect(titles[0]).toBe("Finale");
    // "demi" keyword → priority 1
    expect(titles[1]).toBe("Demi-finales");
    // "quart" keyword → priority 2
    expect(titles[2]).toBe("Quarts de finale");
    // "8e" keyword → priority 3
    expect(titles[3]).toBe("8e de finale");
    // "16e" keyword → priority 4
    expect(titles[4]).toBe("16e de finale");
    // unknown → priority 5, must come last
    expect(titles[5]).toBe("Tour préliminaire");
  });
});
