import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { mockNavigation } from "../../../../__tests__/mocks/mockNavigation";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthRepository } from "../../../../features/auth/context/AuthContext";
import { clubRefundsDueControllerList } from "../../../../api/generated/sdk.gen";
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

// Configure-client side-effect is irrelevant in tests.
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  clubRefundsDueControllerList: jest.fn(),
}));
const refundsDueMock = clubRefundsDueControllerList as jest.Mock;

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

  // Cold start (#615, same mechanism as #514). The first render requires the
  // lazy `react-native` getters, the draggable list and its gesture/animation
  // stack, and babel-transforms them when the Jest cache is cold. Under load
  // that cost ran out the FIRST test's 15 s budget while the test itself takes
  // well under a second once the modules are loaded. Pay it once here, under
  // its own budget, so every test only measures behaviour.
  const WARM_UP_TIMEOUT_MS = 120_000;
  beforeAll(async () => {
    (useTheme as jest.Mock).mockReturnValue(mockTheme);
    (useAuthRepository as jest.Mock).mockReturnValue({
      getAuthConfig: jest.fn().mockResolvedValue({ clubName: "Mon Club" }),
      getClubDashboardConfig: jest.fn().mockResolvedValue(null),
      setClubDashboardConfig: jest.fn().mockResolvedValue(undefined),
    });
    (ClubService.getMembers as jest.Mock).mockResolvedValue([]);
    const { findByText, unmount } = await render(
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
    // Let the focus loads settle before unmounting.
    await findByText("Mon Club");
    await unmount();
  }, WARM_UP_TIMEOUT_MS);

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
    refundsDueMock.mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 1, hasMore: false } },
    });
  });

  const renderDashboard = () =>
    render(
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

  it("shows the number of refunds due and opens their list (#516)", async () => {
    refundsDueMock.mockResolvedValue({
      data: { data: [], meta: { total: 3, skip: 0, take: 1, hasMore: true } },
    });

    const { getByText, getByTestId } = await renderDashboard();

    await waitFor(() => {
      expect(getByText("3 remboursements à effectuer")).toBeTruthy();
    });
    expect(refundsDueMock).toHaveBeenCalledWith({ query: { take: 1 } });

    await fireEvent.press(getByTestId("club-dashboard-refunds-row"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("ClubRefundsDue");
  });

  it("says when a single refund is due", async () => {
    refundsDueMock.mockResolvedValue({
      data: { data: [], meta: { total: 1, skip: 0, take: 1, hasMore: true } },
    });

    const { getByText } = await renderDashboard();

    await waitFor(() => {
      expect(getByText("1 remboursement à effectuer")).toBeTruthy();
    });
  });

  it("keeps the refunds entry with a neutral subtitle when the count fails", async () => {
    refundsDueMock.mockRejectedValue(new Error("network"));

    const { getByText } = await renderDashboard();

    await waitFor(() => {
      expect(getByText("Paiements HelloAsso à rembourser")).toBeTruthy();
    });
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
