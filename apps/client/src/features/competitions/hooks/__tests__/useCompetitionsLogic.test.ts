import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import api from "../../../../services/api";
import { useAuthRepository } from "../../../auth/context/AuthContext";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import {
  CompetitionDiscipline,
  CompetitionStyle,
  pollSyncCompletion,
  useCompetitionsLogic,
} from "../useCompetitionsLogic";

jest.mock("../../../../services/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn().mockReturnValue({ theme: { colors: {}, dark: false } }),
}));

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("../../context/CompetitionContext", () => ({
  useCompetitionRepository: jest.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

/** Minimal competition factory */
const makeCompetition = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "comp-1",
  title: "Test Competition",
  status: "UPCOMING",
  events: [{ category: "Standard", level: "D", ageGroup: "Adulte" }],
  ...overrides,
});

// ─── Shared mock function references ──────────────────────────────────────────

const mockGetCompetitions = jest.fn();
const mockSyncCompetitions = jest.fn();
const mockGetAuthConfig = jest.fn();

// ─── Default mock return values ───────────────────────────────────────────────

const defaultPageResponse = {
  data: [makeCompetition()],
  meta: { hasMore: false, total: 1, skip: 0, take: 10 },
};

const defaultAuthConfig = {
  isGuest: false,
  role: "LICENSEE",
  category: "Standard",
  level: "D",
  ageGroup: "Adulte",
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("useCompetitionsLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockReset();

    jest.mocked(useCompetitionRepository).mockReturnValue({
      getCompetitions: mockGetCompetitions,
      syncCompetitions: mockSyncCompetitions,
      // Satisfy the full interface with no-op stubs
      getCompetitionDetails: jest.fn(),
      getCompetitionDetailsForUser: jest.fn(),
      registerForEvent: jest.fn(),
      getResults: jest.fn(),
      getEventRegistrations: jest.fn(),
      unregisterFromEvent: jest.fn(),
      getUserRegistrations: jest.fn(),
      getClubPendingRegistrations: jest.fn(),
      registerMember: jest.fn(),
      confirmRegistration: jest.fn(),
      unregisterMember: jest.fn(),
    });

    // Keep a stable object reference so the useCallback([auth]) dependency
    // does not cause infinite re-runs.
    const stableAuth = { getAuthConfig: mockGetAuthConfig };
    jest.mocked(useAuthRepository).mockReturnValue(stableAuth as never);

    mockGetCompetitions.mockResolvedValue(defaultPageResponse);
    mockSyncCompetitions.mockResolvedValue(null);
    mockGetAuthConfig.mockResolvedValue(defaultAuthConfig);
  });

  // ── 1. Initial state ────────────────────────────────────────────────────────

  it("returns scope=ALL and statusFilter=UPCOMING as defaults after settings load", async () => {
    // Use a guest config so no preference overwrites the defaults
    mockGetAuthConfig.mockResolvedValue({ isGuest: true });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.scope).toBe("ALL");
      expect(result.current.state.statusFilter).toBe("UPCOMING");
    });
  });

  // ── 2. setScope updates state ───────────────────────────────────────────────

  it("updates scope when setScope is called with FOR_ME", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setScope("FOR_ME");
    });

    expect(result.current.state.scope).toBe("FOR_ME");
  });

  // ── 3. setStatusFilter updates state ───────────────────────────────────────

  it("updates statusFilter when setStatusFilter is called with PAST", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setStatusFilter("PAST");
    });

    expect(result.current.state.statusFilter).toBe("PAST");
  });

  // ── 4. FOR_ME scope filters to matching competitions only ───────────────────

  it("returns only eligible/registered competitions when scope=FOR_ME (licensee)", async () => {
    // « Pour moi » s'appuie désormais sur le flag backend isEligible/isRegistered
    // (source de vérité), plus sur un match approximatif de profil côté client.
    const matching = makeCompetition({
      id: "comp-match",
      isEligible: true,
    });
    const nonMatching = makeCompetition({
      id: "comp-no-match",
      isEligible: false,
      isRegistered: false,
    });

    mockGetCompetitions.mockResolvedValue({
      data: [matching, nonMatching],
      meta: { hasMore: false },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setScope("FOR_ME");
    });

    await waitFor(() => {
      expect(result.current.state.competitions).toHaveLength(1);
      expect(result.current.state.competitions[0].id).toBe("comp-match");
    });
  });

  // ── 4b. Filtres avancés : style / discipline / plage de dates ────────────────

  it("filtre par style de danse (Latine, Ten Dance compte comme les deux)", async () => {
    const latin = makeCompetition({
      id: "lat",
      events: [{ category: "Latin", ageGroup: "Adulte" }],
    });
    const std = makeCompetition({
      id: "std",
      events: [{ category: "Standard", ageGroup: "Adulte" }],
    });
    const ten = makeCompetition({
      id: "ten",
      events: [{ category: "Ten Dance", ageGroup: "Adulte" }],
    });
    mockGetCompetitions.mockResolvedValue({
      data: [latin, std, ten],
      meta: { hasMore: false },
    });
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setStyleFilter(
        new Set<CompetitionStyle>(["Latin"]),
      );
    });
    await waitFor(() => {
      expect(result.current.state.competitions.map((c) => c.id).sort()).toEqual(
        ["lat", "ten"],
      );
    });
  });

  it("filtre par discipline (Solo Team via eventKind, Couple via eventType)", async () => {
    const team = makeCompetition({
      id: "team",
      events: [
        { category: "Latin", ageGroup: "Adulte", eventKind: "SOLO_TEAM" },
      ],
    });
    const couple = makeCompetition({
      id: "couple",
      events: [{ category: "Latin", ageGroup: "Adulte", eventType: "COUPLE" }],
    });
    mockGetCompetitions.mockResolvedValue({
      data: [team, couple],
      meta: { hasMore: false },
    });
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setDisciplineFilter(
        new Set<CompetitionDiscipline>(["SOLO_TEAM"]),
      );
    });
    await waitFor(() => {
      expect(result.current.state.competitions.map((c) => c.id)).toEqual([
        "team",
      ]);
    });
  });

  it("filtre par plage de dates perso (from/to)", async () => {
    const inRange = makeCompetition({
      id: "in",
      date: "2026-08-15T09:00:00.000Z",
    });
    const outRange = makeCompetition({
      id: "out",
      date: "2026-12-15T09:00:00.000Z",
    });
    mockGetCompetitions.mockResolvedValue({
      data: [inRange, outRange],
      meta: { hasMore: false },
    });
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setStatusFilter("ALL");
      result.current.actions.setDateFrom(new Date("2026-08-01T00:00:00.000Z"));
      result.current.actions.setDateTo(new Date("2026-08-31T00:00:00.000Z"));
    });
    await waitFor(() => {
      expect(result.current.state.competitions.map((c) => c.id)).toEqual([
        "in",
      ]);
    });
  });

  // ── 5. ALL scope returns every competition regardless of eligibility ─────────

  it("returns all competitions when scope=ALL regardless of profile match", async () => {
    const comp1 = makeCompetition({
      id: "c1",
      events: [{ category: "Standard", level: "D", ageGroup: "Adulte" }],
    });
    const comp2 = makeCompetition({
      id: "c2",
      events: [{ category: "Latin", level: "C", ageGroup: "Junior" }],
    });

    mockGetCompetitions.mockResolvedValue({
      data: [comp1, comp2],
      meta: { hasMore: false },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    // Default scope is ALL; status filter is UPCOMING, both comps default to UPCOMING
    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.competitions).toHaveLength(2);
    });
  });

  // ── 6. onLoadMore calls fetchNextPage when there is a next page ─────────────

  it("calls fetchNextPage when hasNextPage=true via onLoadMore", async () => {
    // First page has more results — and is full (10 matching items), so the
    // auto-fetch of short filtered lists does not kick in on its own.
    mockGetCompetitions
      .mockResolvedValueOnce({
        data: Array.from({ length: 10 }, (_, i) =>
          makeCompetition({ id: `c1-${i}` }),
        ),
        meta: { hasMore: true },
      })
      .mockResolvedValueOnce({
        data: [makeCompetition({ id: "c2" })],
        meta: { hasMore: false },
      });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.hasMore).toBe(true));
    expect(mockGetCompetitions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.actions.onLoadMore();
    });

    // getCompetitions should have been called a second time for the next page
    expect(mockGetCompetitions).toHaveBeenCalledTimes(2);
  });

  // ── 7. onLoadMore does nothing when there is no next page ───────────────────

  it("does not fetch when hasNextPage=false via onLoadMore", async () => {
    mockGetCompetitions.mockResolvedValue({
      data: [makeCompetition()],
      meta: { hasMore: false },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));
    expect(result.current.state.hasMore).toBe(false);

    await act(async () => {
      await result.current.actions.onLoadMore();
    });

    // Only the initial fetch, no second call
    expect(mockGetCompetitions).toHaveBeenCalledTimes(1);
  });

  // ── 8. onRefresh calls syncCompetitions then refetch ────────────────────────

  it("calls syncCompetitions and refetches on onRefresh", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(mockSyncCompetitions).toHaveBeenCalledTimes(1);
    // getCompetitions is called once on mount + once on refetch
    expect(mockGetCompetitions).toHaveBeenCalledTimes(2);
  });

  // ── 9. isLoading is true while query is pending ─────────────────────────────

  it("exposes isLoading=true while the initial query is in-flight", async () => {
    // Never resolves during this synchronous check
    mockGetCompetitions.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    expect(result.current.state.isLoading).toBe(true);
  });

  // ── 10. Empty competitions when no data returned ────────────────────────────

  it("returns empty competitions array when query returns no data", async () => {
    mockGetCompetitions.mockResolvedValue({
      data: [],
      meta: { hasMore: false },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    expect(result.current.state.competitions).toHaveLength(0);
  });

  // ── 11. Status filter LIVE shows only live competitions ─────────────────────

  it("returns only LIVE competitions when statusFilter=LIVE", async () => {
    const liveComp = makeCompetition({ id: "live-1", status: "LIVE" });
    const upcomingComp = makeCompetition({
      id: "upcoming-1",
      status: "UPCOMING",
    });

    mockGetCompetitions.mockResolvedValue({
      data: [liveComp, upcomingComp],
      meta: { hasMore: false },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(() => {
      result.current.actions.setStatusFilter("LIVE");
    });

    await waitFor(() => {
      expect(result.current.state.competitions).toHaveLength(1);
      expect(result.current.state.competitions[0].id).toBe("live-1");
    });
  });

  // ── 12. competitions list is correctly flattened from pages ─────────────────

  it("flattens competitions from multiple query pages", async () => {
    mockGetCompetitions
      .mockResolvedValueOnce({
        data: Array.from({ length: 10 }, (_, i) =>
          makeCompetition({ id: `p1-c${i}` }),
        ),
        meta: { hasMore: true },
      })
      .mockResolvedValueOnce({
        data: [makeCompetition({ id: "p2-c1" })],
        meta: { hasMore: false },
      });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    // Wait for first page to load
    await waitFor(() => expect(result.current.state.hasMore).toBe(true));

    // Trigger second page
    await act(async () => {
      await result.current.actions.onLoadMore();
    });

    await waitFor(() => {
      // All competitions from both pages should appear
      expect(result.current.state.competitions).toHaveLength(11);
    });
  });

  // ── 13. Guest user: scope forced to ALL ─────────────────────────────────────

  it("forces scope=ALL for guest users", async () => {
    mockGetAuthConfig.mockResolvedValue({ isGuest: true });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.isGuest).toBe(true);
      expect(result.current.state.scope).toBe("ALL");
    });
  });

  // ── 14. CLUB role: scope always forced to ALL ────────────────────────────────

  it("respects defaultCompetitionScope for CLUB (FOR_ME = their events)", async () => {
    // Les clubs ont désormais un filtre Toutes/Les nôtres ; on ne force plus ALL.
    mockGetAuthConfig.mockResolvedValue({
      isGuest: false,
      role: "CLUB",
      defaultCompetitionScope: "registrant",
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("CLUB");
      expect(result.current.state.scope).toBe("FOR_ME");
    });
  });

  // ── 15. Preferences applied on load ─────────────────────────────────────────

  it("applies defaultCompetitionScope=registrant as FOR_ME for LICENSEE", async () => {
    mockGetAuthConfig.mockResolvedValue({
      isGuest: false,
      role: "LICENSEE",
      defaultCompetitionScope: "registrant",
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.scope).toBe("FOR_ME");
    });
  });

  // ── 16. onRefresh polls sync job completion before refetch ───────────────────

  it("polls sync status and refetches after job completes", async () => {
    mockSyncCompetitions.mockResolvedValue({ jobId: "job1" });
    (api.get as jest.Mock).mockResolvedValue({
      data: { status: "completed" },
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(api.get).toHaveBeenCalledWith("/competitions/sync/status");
    // getCompetitions called once on mount + once on refetch
    expect(mockGetCompetitions).toHaveBeenCalledTimes(2);
  });

  // ── 17. onRefresh calls refetch when syncResult is null ──────────────────────

  it("calls refetch even when syncCompetitions returns null (no jobId)", async () => {
    mockSyncCompetitions.mockResolvedValue(null);

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(mockGetCompetitions).toHaveBeenCalledTimes(2);
  });

  // ── 18. onRefresh calls refetch even if polling throws ───────────────────────

  it("calls refetch even if polling api.get throws", async () => {
    mockSyncCompetitions.mockResolvedValue({ jobId: "job1" });
    (api.get as jest.Mock).mockRejectedValue(new Error("Network error"));

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(mockGetCompetitions).toHaveBeenCalledTimes(2);
  });
});

// ── pollSyncCompletion unit tests ────────────────────────────────────────────

describe("pollSyncCompletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves immediately when status is completed", async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { status: "completed" },
    });

    await expect(pollSyncCompletion("job1")).resolves.toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when status is failed", async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { status: "failed", error: "Something went wrong" },
    });

    await expect(pollSyncCompletion("job1")).resolves.toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("polls multiple times until completed", async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { status: "pending" } })
      .mockResolvedValueOnce({ data: { status: "active" } })
      .mockResolvedValueOnce({ data: { status: "completed" } });

    // Use very small interval to avoid slow tests
    await expect(pollSyncCompletion("job1", 1)).resolves.toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it("times out and resolves without throwing", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { status: "pending" } });

    // 0ms timeout makes deadline = Date.now() + 0, so the while condition is
    // immediately false — deterministic regardless of timing
    await expect(pollSyncCompletion("job1", 1, 0)).resolves.toBeUndefined();
  });
});
