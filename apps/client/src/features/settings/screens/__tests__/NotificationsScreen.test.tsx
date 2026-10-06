import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

  const navigation = { goBack: jest.fn(), navigate: jest.fn() };

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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { getByText } = await render(
      <QueryClientProvider client={client}>
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
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByText("Nouvelle notification")).toBeTruthy();
    });

    await fireEvent.press(getByText("Tout lire"));
    await waitFor(() => {
      expect(BackendService.markAllNotificationsAsRead).toHaveBeenCalled();
    });
  });

  // Avant correctif, `onPress` ne faisait que marquer comme lue : taper une
  // notification ne menait nulle part, ce qui a été signalé depuis l'appareil.
  const renderScreen = async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
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
        />
      </QueryClientProvider>,
    );
  };

  it("opens the competition a notification points at", async () => {
    (BackendService.getNotifications as jest.Mock).mockResolvedValue([
      {
        id: "n1",
        title: "Inscription validée",
        body: "Test",
        createdAt: new Date().toISOString(),
        isRead: true,
        data: { competitionId: "comp-42" },
      },
    ]);
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText("Inscription validée")).toBeTruthy());

    await fireEvent.press(getByText("Inscription validée"));

    expect(navigation.navigate).toHaveBeenCalledWith("CompetitionDetail", {
      competitionId: "comp-42",
    });
  });

  // Un type ajouté côté serveur ne doit pas faire planter un client plus ancien :
  // ce qu'on ne reconnaît pas ne mène nulle part, silencieusement.
  it("does nothing when the payload carries no known destination", async () => {
    (BackendService.getNotifications as jest.Mock).mockResolvedValue([
      {
        id: "n2",
        title: "Type inconnu",
        body: "Test",
        createdAt: new Date().toISOString(),
        isRead: true,
        data: { somethingNewFromTheServer: "x" },
      },
    ]);
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText("Type inconnu")).toBeTruthy());

    await fireEvent.press(getByText("Type inconnu"));

    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
