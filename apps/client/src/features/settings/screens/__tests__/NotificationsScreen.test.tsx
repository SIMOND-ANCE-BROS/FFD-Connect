import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { BackendService } from "../../../../services/BackendService";
import { NotificationsScreen } from "../NotificationsScreen";

jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));
jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    getNotifications: jest.fn(),
    markAllNotificationsAsRead: jest.fn(),
    markNotificationAsRead: jest.fn(),
  },
}));

describe("NotificationsScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  const navigation = { goBack: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
    (useAuthRepository as jest.Mock).mockReturnValue({
      getAuthConfig: jest.fn().mockResolvedValue({ authToken: "token" }),
    });
    (BackendService.getNotifications as jest.Mock).mockResolvedValue([
      {
        id: "n1",
        title: "Nouvelle notification",
        body: "Test",
        createdAt: new Date().toISOString(),
        isRead: false,
      },
    ]);
  });

  it("renders notifications and marks all as read", async () => {
    const { getByText } = await render(
      <NotificationsScreen
        navigation={
          navigation as unknown as NonNullable<
            Parameters<typeof NotificationsScreen>[0]
          >["navigation"]
        }
        route={
          {} as unknown as NonNullable<
            Parameters<typeof NotificationsScreen>[0]
          >["route"]
        }
      />,
    );

    await waitFor(() => {
      expect(getByText("Nouvelle notification")).toBeTruthy();
    });

    await fireEvent.press(getByText("Tout lire"));
    await waitFor(() => {
      expect(BackendService.markAllNotificationsAsRead).toHaveBeenCalled();
    });
  });
});
