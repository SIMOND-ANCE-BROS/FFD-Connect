import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { NotificationApi } from "../../../../services/api/notification-api";
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
jest.mock("../../../../services/api/notification-api", () => ({
  NotificationApi: {
    deleteNotification: jest.fn(),
    deleteAllNotifications: jest.fn(),
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
    danger: "#ef4444",
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
    (NotificationApi.deleteNotification as jest.Mock).mockResolvedValue(
      undefined,
    );
    (NotificationApi.deleteAllNotifications as jest.Mock).mockResolvedValue(1);
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

  it.each([
    [
      "an admin to the correction review queue",
      { type: "TRACK_CORRECTION", correctionId: "c1", trackId: "t1" },
      ["TrackCorrectionsReview", { correctionId: "c1" }],
    ],
    [
      "the proposer to their proposals",
      {
        type: "TRACK_CORRECTION_DECISION",
        correctionId: "c1",
        trackId: "t1",
        status: "APPROVED",
      },
      ["MyTrackCorrections"],
    ],
  ])(
    "routes a track correction notification for %s",
    async (_l, data, call) => {
      (BackendService.getNotifications as jest.Mock).mockResolvedValue([
        {
          id: "n1",
          title: "Correction de musique",
          body: "Test",
          createdAt: new Date().toISOString(),
          isRead: true,
          data,
        },
      ]);
      const { getByText } = await renderScreen();
      await waitFor(() =>
        expect(getByText("Correction de musique")).toBeTruthy(),
      );

      await fireEvent.press(getByText("Correction de musique"));

      expect(navigation.navigate).toHaveBeenCalledWith(...call);
    },
  );

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

  // Le dépôt renvoyait un objet littéral neuf à chaque rendu : `loadNotifications`
  // en dépendait, l'effet se redéclenchait donc à chaque rendu, et chaque
  // réponse provoquait le rendu suivant. L'écran rechargeait le feed en boucle
  // — invisible à l'œil, mais c'est une requête par rendu sur une API qui se
  // réveille à la demande.
  it("loads the feed once, instead of refetching on every render", async () => {
    const { getByText } = await renderScreen();
    await waitFor(() =>
      expect(getByText("Nouvelle notification")).toBeTruthy(),
    );

    expect(BackendService.getNotifications).toHaveBeenCalledTimes(1);
  });

  // ─── Suppression (#84 : « les notifications ne sont pas supprimables ») ────

  it("deletes a notification from its own button, without opening it", async () => {
    const { getByTestId, queryByText } = await renderScreen();
    await waitFor(() =>
      expect(getByTestId("notifications-delete-n1")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("notifications-delete-n1"));

    await waitFor(() =>
      expect(NotificationApi.deleteNotification).toHaveBeenCalledWith("n1"),
    );
    // La corbeille est un frère de la zone d'ouverture, pas un enfant : appuyer
    // dessus ne doit ni marquer comme lu ni naviguer.
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(BackendService.markNotificationAsRead).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(queryByText("Nouvelle notification")).toBeNull(),
    );
  });

  it("asks for confirmation before clearing everything", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const { getByTestId } = await renderScreen();
    await waitFor(() =>
      expect(getByTestId("notifications-clear-all-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("notifications-clear-all-button"));

    expect(alert).toHaveBeenCalled();
    // Rien n'est parti tant que l'utilisateur n'a pas confirmé.
    expect(NotificationApi.deleteAllNotifications).not.toHaveBeenCalled();

    alert.mockRestore();
  });

  it("clears the feed once the destructive choice is confirmed", async () => {
    let confirm: (() => void) | undefined;
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => {
        confirm = buttons?.find((b) => b.style === "destructive")?.onPress;
      });

    const { getByTestId, queryByText } = await renderScreen();
    await waitFor(() =>
      expect(getByTestId("notifications-clear-all-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("notifications-clear-all-button"));
    expect(confirm).toBeDefined();
    confirm?.();

    await waitFor(() =>
      expect(NotificationApi.deleteAllNotifications).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(queryByText("Nouvelle notification")).toBeNull(),
    );

    alert.mockRestore();
  });

  it("offers no clear-all action on an empty feed", async () => {
    (BackendService.getNotifications as jest.Mock).mockResolvedValue([]);

    const { getByTestId, queryByTestId } = await renderScreen();
    await waitFor(() =>
      expect(getByTestId("notifications-empty-state")).toBeTruthy(),
    );

    expect(queryByTestId("notifications-clear-all-button")).toBeNull();
  });
});
