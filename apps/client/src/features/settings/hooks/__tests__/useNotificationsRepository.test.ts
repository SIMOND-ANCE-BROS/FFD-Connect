import { renderHook } from "@testing-library/react-native";
import { useAuthRepository } from "../../../auth/context/AuthContext";
import { BackendService } from "../../../../services/BackendService";
import { useNotificationsRepository } from "../useNotificationsRepository";

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));
jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    getNotifications: jest.fn(),
    markNotificationAsRead: jest.fn(),
    markAllNotificationsAsRead: jest.fn(),
  },
}));

describe("useNotificationsRepository", () => {
  const mockGetAuthConfig = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthRepository as jest.Mock).mockReturnValue({
      getAuthConfig: mockGetAuthConfig,
    });
    mockGetAuthConfig.mockResolvedValue({ authToken: "token-123" });
    (BackendService.getNotifications as jest.Mock).mockResolvedValue([]);
    (BackendService.markNotificationAsRead as jest.Mock).mockResolvedValue(
      undefined,
    );
    (BackendService.markAllNotificationsAsRead as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  it("getNotifications calls BackendService with auth token", async () => {
    const { result } = await renderHook(() => useNotificationsRepository());

    const notifications = await result.current.getNotifications();

    expect(mockGetAuthConfig).toHaveBeenCalled();
    expect(BackendService.getNotifications).toHaveBeenCalledWith("token-123");
    expect(notifications).toEqual([]);
  });

  it("getNotifications throws when no auth token", async () => {
    mockGetAuthConfig.mockResolvedValue({ authToken: null });

    const { result } = await renderHook(() => useNotificationsRepository());

    await expect(result.current.getNotifications()).rejects.toThrow(
      "No auth token available",
    );
  });

  it("markAsRead calls BackendService", async () => {
    const { result } = await renderHook(() => useNotificationsRepository());

    await result.current.markAsRead("n1");

    expect(BackendService.markNotificationAsRead).toHaveBeenCalledWith(
      "token-123",
      "n1",
    );
  });

  it("markAsRead throws when no auth token", async () => {
    mockGetAuthConfig.mockResolvedValue({ authToken: null });

    const { result } = await renderHook(() => useNotificationsRepository());

    await expect(result.current.markAsRead("n1")).rejects.toThrow(
      "No auth token available",
    );
  });

  it("markAllAsRead calls BackendService", async () => {
    const { result } = await renderHook(() => useNotificationsRepository());

    await result.current.markAllAsRead();

    expect(BackendService.markAllNotificationsAsRead).toHaveBeenCalledWith(
      "token-123",
    );
  });

  it("markAllAsRead throws when no auth token", async () => {
    mockGetAuthConfig.mockResolvedValue({ authToken: null });

    const { result } = await renderHook(() => useNotificationsRepository());

    await expect(result.current.markAllAsRead()).rejects.toThrow(
      "No auth token available",
    );
  });
});
