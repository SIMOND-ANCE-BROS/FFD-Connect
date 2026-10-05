import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useNotificationsLogic } from "../useNotificationsLogic";

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
    const { result } = await renderHook(() => useNotificationsLogic());

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

    const { result } = await renderHook(() => useNotificationsLogic());

    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    });

    expect(result.current.state.notifications).toHaveLength(0);
  });

  it("onMarkAsRead calls repo", async () => {
    const { result } = await renderHook(() => useNotificationsLogic());

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

    const { result } = await renderHook(() => useNotificationsLogic());

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

    const { result } = await renderHook(() => useNotificationsLogic());

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onMarkAsRead("n1");
    });

    expect(result.current.state.notifications[0].isRead).toBe(false);
  });

  it("onReadAll calls repo", async () => {
    const { result } = await renderHook(() => useNotificationsLogic());

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

    const { result } = await renderHook(() => useNotificationsLogic());

    await waitFor(() => {
      expect(result.current.state.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.actions.onReadAll();
    });

    expect(result.current.state.notifications[0].isRead).toBe(false);
  });

  it("onRefresh reloads notifications", async () => {
    const { result } = await renderHook(() => useNotificationsLogic());

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
});
