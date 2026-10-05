import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { mockNavigation } from "../../../../__tests__/mocks/mockNavigation";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { ClubService } from "../../services/ClubService";
import { ClubDashboardScreen } from "../ClubDashboardScreen";

// Mock Auth Context
jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

// NotificationBell relies on React Query (unread count) — out of scope here.
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// Inline ThemeContext Mock for stability
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Navigation
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
  useFocusEffect: (cb: () => (() => void) | void) => {
    const { useEffect } = require("react") as typeof import("react");
    // Deps sur [cb] : le vrai useFocusEffect ne relance PAS l'effet à chaque
    // render. Sans deps, cb() (loadDashboardData) se rappelle après chaque
    // setState → boucle de rendu que le render async de RNTL 14 n'atteint
    // jamais quiescent → timeout.
    useEffect(() => {
      const cleanup = cb();
      return cleanup;
    }, [cb]);
  },
}));

// Mock Club Service
jest.mock("../../services/ClubService");

describe("ClubDashboardScreen", () => {
  const mockTheme = {
    theme: {
      background: "#ffffff",
      surface: "#f2f2f2",
      text: "#111111",
      textSecondary: "#666666",
      primary: "#3b82f6",
      border: "#e5e7eb",
    },
    isDark: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
    (useAuthRepository as jest.Mock).mockReturnValue({
      getAuthConfig: jest.fn().mockResolvedValue({ clubName: "Mon Club" }),
      getClubDashboardConfig: jest.fn().mockResolvedValue(null),
      setClubDashboardConfig: jest.fn().mockResolvedValue(undefined),
    });
    (ClubService.getMembers as jest.Mock).mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
    ]);
  });

  it("renders club name and navigates to members", async () => {
    const { getByText } = await render(
      <ClubDashboardScreen
        navigation={
          mockNavigation as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["navigation"]
        }
        route={
          {
            key: "ClubDashboard",
            name: "ClubDashboard",
            params: undefined,
          } as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["route"]
        }
      />,
    );

    await waitFor(() => {
      expect(getByText("Mon Club")).toBeTruthy();
    });

    await fireEvent.press(getByText("Membres"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("ClubMembers");
  });

  it("shows registrations widgets only when registration mode is CLUB_AND_MEMBERS_PENDING", async () => {
    (ClubService.getMembers as jest.Mock).mockResolvedValue([]);
    (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
      registrationMode: "CLUB_AND_MEMBERS_PENDING",
    });

    const { getByText } = await render(
      <ClubDashboardScreen
        navigation={
          mockNavigation as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["navigation"]
        }
        route={
          {
            key: "ClubDashboard",
            name: "ClubDashboard",
            params: undefined,
          } as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["route"]
        }
      />,
    );

    await waitFor(() => {
      expect(getByText("Inscriptions")).toBeTruthy();
      expect(getByText("Inscriptions en attente")).toBeTruthy();
    });
  });

  it("does not show registrations widgets when mode is MEMBERS_AUTO_CONFIRM", async () => {
    (ClubService.getMembers as jest.Mock).mockResolvedValue([]);
    (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
      registrationMode: "MEMBERS_AUTO_CONFIRM",
    });

    const { queryByText } = await render(
      <ClubDashboardScreen
        navigation={
          mockNavigation as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["navigation"]
        }
        route={
          {
            key: "ClubDashboard",
            name: "ClubDashboard",
            params: undefined,
          } as unknown as NonNullable<
            Parameters<typeof ClubDashboardScreen>[0]
          >["route"]
        }
      />,
    );

    await waitFor(() => {
      expect(queryByText("Inscriptions en attente")).toBeNull();
    });
  });
});
