import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { useCompetitionRepository } from "../../context/CompetitionContext";
import {
  isValidCompetitionScope,
  isValidCompetitionStatusFilter,
  MAX_AUTO_PAGES,
  toCompetitionScope,
  toCompetitionStatusFilter,
  useCompetitionsLogic,
} from "../useCompetitionsLogic";

// Mock Dependencies
jest.mock("../../context/CompetitionContext", () => {
  return {
    useCompetitionRepository: jest.fn(),
  };
});
jest.mock("../../../../features/auth/context/AuthContext", () => {
  return {
    useAuthRepository: jest.fn(),
  };
});
jest.mock("../../../../context/ThemeContext", () => {
  return {
    useTheme: jest.fn(),
  };
});

describe("useCompetitionsLogic - pure functions", () => {
  describe("isValidCompetitionScope", () => {
    it("returns true for ALL", () => {
      expect(isValidCompetitionScope("ALL")).toBe(true);
    });
    it("returns true for FOR_ME", () => {
      expect(isValidCompetitionScope("FOR_ME")).toBe(true);
    });
    it("returns false for invalid values", () => {
      expect(isValidCompetitionScope("INVALID")).toBe(false);
      expect(isValidCompetitionScope("")).toBe(false);
      expect(isValidCompetitionScope("all")).toBe(false);
    });
  });

  describe("isValidCompetitionStatusFilter", () => {
    it("returns true for UPCOMING, LIVE, PAST, ALL", () => {
      expect(isValidCompetitionStatusFilter("UPCOMING")).toBe(true);
      expect(isValidCompetitionStatusFilter("LIVE")).toBe(true);
      expect(isValidCompetitionStatusFilter("PAST")).toBe(true);
      expect(isValidCompetitionStatusFilter("ALL")).toBe(true);
    });
    it("returns false for invalid values", () => {
      expect(isValidCompetitionStatusFilter("INVALID")).toBe(false);
      expect(isValidCompetitionStatusFilter("")).toBe(false);
    });
  });

  describe("toCompetitionScope", () => {
    it("returns value when valid", () => {
      expect(toCompetitionScope("ALL")).toBe("ALL");
      expect(toCompetitionScope("FOR_ME")).toBe("FOR_ME");
    });
    it("returns ALL when invalid", () => {
      expect(toCompetitionScope("foo")).toBe("ALL");
      expect(toCompetitionScope("")).toBe("ALL");
    });
  });

  describe("toCompetitionStatusFilter", () => {
    it("returns value when valid", () => {
      expect(toCompetitionStatusFilter("UPCOMING")).toBe("UPCOMING");
      expect(toCompetitionStatusFilter("LIVE")).toBe("LIVE");
      expect(toCompetitionStatusFilter("PAST")).toBe("PAST");
      expect(toCompetitionStatusFilter("ALL")).toBe("ALL");
    });
    it("returns UPCOMING when invalid", () => {
      expect(toCompetitionStatusFilter("foo")).toBe("UPCOMING");
      expect(toCompetitionStatusFilter("")).toBe("UPCOMING");
    });
  });
});

describe("useCompetitionsLogic", () => {
  const mockCompetitions = [
    {
      id: "c1",
      title: "Comp 1",
      status: "UPCOMING",
      isEligible: true,
      events: [{ category: "A", level: "Open", ageGroup: "Adult" }],
    },
    {
      id: "c2",
      title: "Comp 2",
      status: "PAST",
      isEligible: false,
      isRegistered: false,
      events: [{ category: "B", level: "Novice", ageGroup: "Junior" }],
    },
  ];

  const mockActions = {
    getCompetitions: jest.fn().mockResolvedValue({
      data: mockCompetitions,
      meta: { hasMore: false },
    }),
    syncCompetitions: jest.fn().mockResolvedValue(null),
  };

  const mockAuth = {
    getAuthConfig: jest.fn(),
  };

  const mockTheme = {
    theme: { colors: {} },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useCompetitionRepository as jest.Mock).mockReturnValue(mockActions);
    (useAuthRepository as jest.Mock).mockReturnValue(mockAuth);
    (useTheme as jest.Mock).mockReturnValue(mockTheme);

    // Default Auth Config
    mockAuth.getAuthConfig.mockResolvedValue({
      isGuest: false,
      role: "LICENSEE",
      category: "A",
      level: "Open",
      ageGroup: "Adult",
    });
  });

  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  it("initializes with default values and loads settings", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockAuth.getAuthConfig).toHaveBeenCalled();
    });

    expect(result.current.state.scope).toBe("ALL");
    expect(result.current.state.statusFilter).toBe("UPCOMING");
    expect(result.current.state.isGuest).toBe(false);
  });

  it("filters competitions by status", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("LICENSEE");
    });

    await act(() => {
      result.current.actions.setStatusFilter("UPCOMING");
    });

    expect(result.current.state.competitions).toHaveLength(1);
    expect(result.current.state.competitions[0].id).toBe("c1");

    await act(() => {
      result.current.actions.setStatusFilter("PAST");
    });
    expect(result.current.state.competitions).toHaveLength(1);
    expect(result.current.state.competitions[0].id).toBe("c2");

    await act(() => {
      result.current.actions.setStatusFilter("ALL");
    });
    expect(result.current.state.competitions).toHaveLength(2);
  });

  it("filters competitions by scope (FOR_ME) using backend eligibility", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("LICENSEE");
    });

    await act(() => {
      result.current.actions.setScope("FOR_ME");
      // Need to set status filter to ALL to see both potentially
      result.current.actions.setStatusFilter("ALL");
    });

    // c1 est éligible (isEligible:true), c2 non → seul c1 reste sous « Pour moi »
    expect(result.current.state.competitions).toHaveLength(1);
    expect(result.current.state.competitions[0].id).toBe("c1");
  });

  it("handles guest user correctly", async () => {
    mockAuth.getAuthConfig.mockResolvedValue({
      isGuest: true,
      role: "GUEST",
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.state.isGuest).toBe(true);
      },
      { timeout: 3000 },
    );

    expect(result.current.state.scope).toBe("ALL");
    expect(result.current.state.role).toBe("LICENSEE");

    // Guest cannot filter by FOR_ME implies scope stays ALL effectively or implementation handles it
    // Logic says: if scope === 'FOR_ME' and !userProfile -> return false (empty list)
    // But Guests shouldn't be able to select FOR_ME ideally, but if they do:
    await act(() => {
      result.current.actions.setScope("FOR_ME");
    });
    expect(result.current.state.competitions).toHaveLength(0);
  });

  it("handles refresh", async () => {
    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(mockActions.getCompetitions).toHaveBeenCalled();
  });

  it("handles refresh when syncCompetitions throws - still reloads", async () => {
    const getCompetitions = jest.fn().mockResolvedValue({
      data: mockCompetitions,
      meta: { hasMore: false },
    });
    (useCompetitionRepository as jest.Mock).mockReturnValue({
      ...mockActions,
      getCompetitions,
      syncCompetitions: jest.fn().mockRejectedValue(new Error("Sync failed")),
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.actions.onRefresh();
    });

    expect(getCompetitions).toHaveBeenCalled();
  });

  it("loads CLUB scope as ALL and defaultCompetitionStatus", async () => {
    mockAuth.getAuthConfig.mockResolvedValue({
      isGuest: false,
      role: "CLUB",
      defaultCompetitionStatus: "LIVE",
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.scope).toBe("ALL");
      expect(result.current.state.statusFilter).toBe("LIVE");
    });
  });

  it("loads defaultCompetitionScope registrant as FOR_ME", async () => {
    mockAuth.getAuthConfig.mockResolvedValue({
      isGuest: false,
      role: "LICENSEE",
      defaultCompetitionScope: "registrant",
      category: "A",
      level: "Open",
      ageGroup: "Adult",
    });

    const { result } = await renderHook(() => useCompetitionsLogic(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state.scope).toBe("FOR_ME");
    });
  });

  describe("pagination when the default filter hides the first pages", () => {
    // Backend pages are ordered by date ascending → the first pages are PAST
    // competitions, all hidden by the default "UPCOMING" filter.
    const pastPage = Array.from({ length: 10 }, (_, i) => ({
      id: `past-${i}`,
      title: `Past ${i}`,
      status: "PAST",
      date: "2020-01-01T10:00:00.000Z",
      events: [],
    }));
    const upcoming = {
      id: "upcoming-1",
      title: "Upcoming",
      status: "UPCOMING",
      date: "2099-01-01T10:00:00.000Z",
      events: [],
    };

    it("fetches the next pages automatically until matches are found", async () => {
      const getCompetitions = jest.fn((skip: number) =>
        Promise.resolve(
          skip === 0
            ? { data: pastPage, meta: { hasMore: true } }
            : { data: [upcoming], meta: { hasMore: false } },
        ),
      );
      (useCompetitionRepository as jest.Mock).mockReturnValue({
        ...mockActions,
        getCompetitions,
      });

      const { result } = await renderHook(() => useCompetitionsLogic(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.state.competitions.map((c) => c.id)).toEqual([
          "upcoming-1",
        ]);
      });
      expect(getCompetitions).toHaveBeenCalledWith(0, 10);
      expect(getCompetitions).toHaveBeenCalledWith(10, 10);
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.hasMore).toBe(false);
    });

    it("keeps the full-screen loader (not the footer one) while pages are scanned", async () => {
      const getCompetitions = jest.fn((skip: number) =>
        skip === 0
          ? Promise.resolve({ data: pastPage, meta: { hasMore: true } })
          : // Next page never resolves: the scan is still in progress.
            new Promise(() => {}),
      );
      (useCompetitionRepository as jest.Mock).mockReturnValue({
        ...mockActions,
        getCompetitions,
      });

      const { result } = await renderHook(() => useCompetitionsLogic(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(getCompetitions).toHaveBeenCalledWith(10, 10);
      });
      expect(result.current.state.competitions).toHaveLength(0);
      expect(result.current.state.isLoading).toBe(true);
      expect(result.current.state.isLoadingMore).toBe(false);
    });

    it("stops fetching once the filtered list can fill the screen", async () => {
      const upcomingPage = Array.from({ length: 10 }, (_, i) => ({
        ...upcoming,
        id: `up-${i}`,
      }));
      const getCompetitions = jest.fn(() =>
        Promise.resolve({ data: upcomingPage, meta: { hasMore: true } }),
      );
      (useCompetitionRepository as jest.Mock).mockReturnValue({
        ...mockActions,
        getCompetitions,
      });

      const { result } = await renderHook(() => useCompetitionsLogic(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.state.competitions).toHaveLength(10);
      });
      expect(getCompetitions).toHaveBeenCalledTimes(1);
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.hasMore).toBe(true);
    });

    describe("auto-fetch budget", () => {
      // An endless catalogue of past competitions: nothing ever matches.
      const endlessPast = () =>
        jest.fn((skip: number) =>
          Promise.resolve({
            data: pastPage.map((c) => ({ ...c, id: `${c.id}-${skip}` })),
            meta: { hasMore: true },
          }),
        );
      // The initial page is not an auto-fetch.
      const CAPPED_CALLS = 1 + MAX_AUTO_PAGES;

      const renderUntilCapped = async (
        getCompetitions: ReturnType<typeof endlessPast>,
      ) => {
        (useCompetitionRepository as jest.Mock).mockReturnValue({
          ...mockActions,
          getCompetitions,
        });
        const rendered = await renderHook(() => useCompetitionsLogic(), {
          wrapper: createWrapper(),
        });
        await waitFor(() => {
          expect(rendered.result.current.state.canLoadMoreManually).toBe(true);
        });
        return rendered;
      };

      it("stops after MAX_AUTO_PAGES when nothing matches and shows the empty state", async () => {
        const getCompetitions = endlessPast();
        const { result } = await renderUntilCapped(getCompetitions);

        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
        expect(getCompetitions).toHaveBeenCalledTimes(CAPPED_CALLS);
        expect(result.current.state.competitions).toHaveLength(0);
        expect(result.current.state.isLoading).toBe(false);
        expect(result.current.state.hasMore).toBe(true);
      });

      it("renews the budget when a filter changes", async () => {
        const getCompetitions = endlessPast();
        const { result } = await renderUntilCapped(getCompetitions);
        expect(getCompetitions).toHaveBeenCalledTimes(CAPPED_CALLS);

        await act(() => {
          result.current.actions.setSearchQuery("introuvable");
        });

        await waitFor(() => {
          expect(getCompetitions).toHaveBeenCalledTimes(
            CAPPED_CALLS + MAX_AUTO_PAGES,
          );
        });
        await waitFor(() => {
          expect(result.current.state.canLoadMoreManually).toBe(true);
        });
        expect(result.current.state.isLoading).toBe(false);
      });

      it("renews the budget on an explicit load more", async () => {
        const getCompetitions = endlessPast();
        const { result } = await renderUntilCapped(getCompetitions);

        await act(async () => {
          await result.current.actions.onLoadMore();
        });

        // The manual page + a fresh auto-fetch budget.
        await waitFor(() => {
          expect(getCompetitions).toHaveBeenCalledTimes(
            CAPPED_CALLS + 1 + MAX_AUTO_PAGES,
          );
        });
        await waitFor(() => {
          expect(result.current.state.canLoadMoreManually).toBe(true);
        });
      });
    });
  });
});
