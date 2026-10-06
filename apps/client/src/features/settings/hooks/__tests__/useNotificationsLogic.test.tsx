import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { useNotificationsLogic } from "../useNotificationsLogic";

/**
 * Le hook invalide la requête du compteur de non-lues après chaque lecture,
 * il lui faut donc un client. `retry: false` pour qu'un échec simulé ne soit
 * pas rejoué et ne ralentisse pas la suite.
 */
const withSpyableQueryClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { wrapper, invalidate };
};

const withQueryClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return wrapper;
};

// Stable object reference — prevents useCallback/useEffect re-trigger loop
const mockStableRepo = {
  getNotifications: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
};

jest.mock("../useNotificationsRepository", () => ({
  useNotificationsRepository: () => mockStableRepo,
}));

describe("useNotificationsLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStableRepo.markAsRead.mockResolvedValue(undefined);
    mockStableRepo.markAllAsRead.mockResolvedValue(undefined);
    mockStableRepo.getNotifications.mockResolvedValue([
      {
        id: "n1",
        title: "Test",
        body: "Body",
        isRead: false,
        createdAt: "2024-01-01",
      },
    ]);
  });

  it("loads notifications on mount", async () => {
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    });

    expect(mockStableRepo.getNotifications).toHaveBeenCalled();
    expect(result.current.state.notifications).toHaveLength(1);
    expect(result.current.state.notifications[0].title).toBe("Test");
  });

  it("handles load error - does not throw, sets loading false", async () => {
    mockStableRepo.getNotifications.mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    });

    expect(result.current.state.notifications).toHaveLength(0);
  });

  it("onMarkAsRead calls repo", async () => {
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onMarkAsRead("n1");
    });

    expect(mockStableRepo.markAsRead).toHaveBeenCalledWith("n1");
  });

  it("onMarkAsRead only marks the targeted notification, leaving others unchanged", async () => {
    mockStableRepo.getNotifications.mockResolvedValue([
      {
        id: "n1",
        title: "First",
        body: "",
        isRead: false,
        createdAt: "2024-01-01",
      },
      {
        id: "n2",
        title: "Second",
        body: "",
        isRead: false,
        createdAt: "2024-01-02",
      },
    ]);

    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(2);
    });

    await act(async () => {
      await result.current.actions.onMarkAsRead("n1");
    });

    expect(result.current.state.notifications[0].isRead).toBe(true);
    expect(result.current.state.notifications[1].isRead).toBe(false);
  });

  it("onMarkAsRead handles error - does not throw", async () => {
    mockStableRepo.markAsRead.mockRejectedValue(new Error("API error"));

    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onMarkAsRead("n1");
    });

    expect(result.current.state.notifications[0].isRead).toBe(false);
  });

  it("onReadAll calls repo", async () => {
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onReadAll();
    });

    expect(mockStableRepo.markAllAsRead).toHaveBeenCalled();
  });

  it("onReadAll handles error - does not throw", async () => {
    mockStableRepo.markAllAsRead.mockRejectedValue(new Error("API error"));

    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onReadAll();
    });

    expect(result.current.state.notifications[0].isRead).toBe(false);
  });

  it("onRefresh reloads notifications", async () => {
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper: withQueryClient(),
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    });

    // Fetch contrôlé : en v14 `await act` draine les microtasks, donc un
    // mockResolvedValue résoudrait onRefresh avant l'assertion → refreshing déjà
    // false. On garde la promesse pendante pour observer refreshing=true, puis on
    // la résout pour vérifier l'état final.
    const refreshed = [
      {
        id: "n2",
        title: "Refreshed",
        body: "Body",
        isRead: false,
        createdAt: "2024-01-02",
      },
    ];
    let resolveRefresh: (value: unknown) => void = () => {};
    mockStableRepo.getNotifications.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await act(() => {
      result.current.actions.onRefresh();
    });

    expect(result.current.state.refreshing).toBe(true);

    await act(async () => {
      resolveRefresh(refreshed);
    });

    await waitFor(() => {
      expect(result.current.state.refreshing).toBe(false);
      expect(result.current.state.notifications[0].title).toBe("Refreshed");
    });
  });

  // La pastille de la cloche lit une requête React Query distincte tandis que
  // les lectures passent par des appels manuels. Sans invalidation elle gardait
  // son ancienne valeur jusqu'à une minute — le défaut signalé depuis l'appareil.
  it("invalidates the unread badge after marking one as read", async () => {
    const { wrapper, invalidate } = withSpyableQueryClient();
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.actions.onMarkAsRead("notif-1");
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "unread-count"],
    });
  });

  it("invalidates the unread badge after marking all as read", async () => {
    const { wrapper, invalidate } = withSpyableQueryClient();
    const { result } = await renderHook(() => useNotificationsLogic(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.actions.onReadAll();
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "unread-count"],
    });
  });
});
