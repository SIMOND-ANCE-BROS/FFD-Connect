import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { BETA_NOTICES } from "../../../../constants/betaNotices";
import { useWakeStore } from "../../../../stores/wake.store";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useCompetitionsLogic } from "../../hooks/useCompetitionsLogic";
import { CompetitionsScreen } from "../CompetitionsScreen";

// Le date-picker natif → stub pour le rendu du calendrier dans la feuille de filtres.
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");

// Mocks
jest.mock("../../hooks/useCompetitionsLogic");

// Cloche de notifs = React Query → hors périmètre de ce test (testée à part).
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// Inline ThemeContext Mock
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: require("../../../../__tests__/mocks/mockTheme")
    .MockThemeProvider,
  useTheme: require("../../../../__tests__/mocks/mockTheme").mockUseTheme,
}));

// Mock FluidSegmentedTab
jest.mock("../../../../components/FluidSegmentedTab", () => {
  const MockReact = require("react");
  const { View, Text } = require("react-native");
  return {
    FluidSegmentedTab: ({
      options,
      activeValue,
    }: {
      options: Array<{ value: string; label: string }>;
      activeValue: string;
    }) => {
      return MockReact.createElement(
        View,
        {},
        options.map((opt: { value: string; label: string }) =>
          MockReact.createElement(
            Text,
            { key: opt.value },
            opt.label + (activeValue === opt.value ? " (Active)" : ""),
          ),
        ),
      );
    },
  };
});

// Mock AppText
jest.mock("../../../../components/AppText");

// Mock Icons — Proxy renders any lucide icon as its name, so new icons
// (SlidersHorizontal, RotateCcw, Clock…) resolve without listing each one.
jest.mock("lucide-react-native", () => {
  const MockReact = require("react");
  const { Text } = require("react-native");
  return new Proxy(
    {},
    {
      get: (_target, name) => () =>
        MockReact.createElement(Text, {}, String(name)),
    },
  );
});

// Mock SafeAreaView
jest.mock("react-native-safe-area-context", () => {
  const MockReact = require("react");
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      MockReact.createElement("SafeAreaView", {}, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

describe("CompetitionsScreen", () => {
  const mockState = {
    competitions: [],
    isRefreshing: false,
    isLoading: false,
    hasMore: false,
    scope: "ALL",
    statusFilter: "UPCOMING",
    searchQuery: "",
    theme: {
      background: "white",
      surface: "gray",
      text: "black",
      textSecondary: "gray",
      border: "lightgray",
      colors: { primary: "blue", background: "white" },
    },
    role: "LICENSEE",
    isGuest: false,
    userLocation: null,
    maxDistanceKm: null,
    datePeriod: "ALL",
    dateFrom: null,
    dateTo: null,
    styleFilter: new Set(),
    disciplineFilter: new Set(),
  };

  const mockActions = {
    setScope: jest.fn(),
    setStatusFilter: jest.fn(),
    setSearchQuery: jest.fn(),
    setMaxDistanceKm: jest.fn(),
    setDatePeriod: jest.fn(),
    setDateFrom: jest.fn(),
    setDateTo: jest.fn(),
    setStyleFilter: jest.fn(),
    setDisciplineFilter: jest.fn(),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    loadMore: jest.fn().mockResolvedValue(undefined),
    onLoadMore: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createTestProps = () =>
    createMockScreenProps("Competitions", undefined);

  it("renders correctly", async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: mockState,
      actions: mockActions,
    });

    const { getByText } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );

    expect(getByText("Compétitions")).toBeTruthy();
    expect(getByText("Toutes (Active)")).toBeTruthy(); // Scope Tab
    expect(getByText("À venir (Active)")).toBeTruthy(); // Status Tab
  });

  it("shows the beta notice (informative only) with or without results", async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: mockState,
      actions: mockActions,
    });

    const { getByTestId, getByText } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );

    expect(getByTestId("competitions-beta-notice")).toBeTruthy();
    expect(getByText(BETA_NOTICES.competitions.message)).toBeTruthy();
  });

  it("offers « Charger plus » in the empty state once the auto-fetch budget is spent", async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        competitions: [],
        hasMore: true,
        canLoadMoreManually: true,
      },
      actions: mockActions,
    });
    const { getByTestId } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("competitions-load-more-button"));
    expect(mockActions.onLoadMore).toHaveBeenCalled();
  });

  it("hides « Charger plus » while the budget is not spent", async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, competitions: [], canLoadMoreManually: false },
      actions: mockActions,
    });
    const { queryByTestId } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );
    expect(queryByTestId("competitions-load-more-button")).toBeNull();
  });

  it("displays different empty state messages pending on status filter", async () => {
    // Test LIVE empty state
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, statusFilter: "LIVE", competitions: [] },
      actions: mockActions,
    });
    const { getByText, rerender } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );
    expect(getByText("Aucun direct")).toBeTruthy();

    // Test PAST empty state
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, statusFilter: "PAST", competitions: [] },
      actions: mockActions,
    });
    await rerender(<CompetitionsScreen {...createTestProps()} />);
    expect(getByText("Historique vide")).toBeTruthy();
  });

  it('handles "FOR_ME" scope correctly', async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, scope: "FOR_ME" },
      actions: mockActions,
    });

    const { getByText } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );
    expect(getByText("Pour moi (Active)")).toBeTruthy();
  });

  it("displays list of competitions and handles navigation", async () => {
    const competitions = [
      {
        id: "c1",
        title: "Comp A",
        date: new Date().toISOString(),
        location: "Paris",
        status: "UPCOMING",
      },
    ];

    const props = createTestProps();
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, competitions },
      actions: mockActions,
    });

    const { getByText } = await render(<CompetitionsScreen {...props} />);

    expect(getByText("Comp A")).toBeTruthy();
    await fireEvent.press(getByText("Comp A"));

    expect(props.navigation.navigate).toHaveBeenCalledWith(
      "CompetitionDetail",
      {
        competitionId: "c1",
      },
    );
  });

  it("never claims « Non inscrit » (federation registrations are not visible)", async () => {
    const date = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const base = { date, location: "Paris", status: "UPCOMING" };
    const competitions = [
      { ...base, id: "c1", title: "Open", isEligible: true },
      {
        ...base,
        id: "c2",
        title: "Mine",
        isEligible: true,
        isRegistered: true,
      },
      { ...base, id: "c3", title: "Closed", isEligible: false },
    ];
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, competitions },
      actions: mockActions,
    });

    const { getByText, queryByText } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );

    expect(queryByText("Non inscrit")).toBeNull();
    expect(getByText("Inscrit")).toBeTruthy();
    expect(getByText("Inéligible")).toBeTruthy();
  });

  it("message vide « Pour moi » (licencié) et « Les nôtres » (club)", async () => {
    // Licencié « Pour moi » vide → parle du profil, pas d'inscription.
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, scope: "FOR_ME", competitions: [] },
      actions: mockActions,
    });
    const { getByText, queryByTestId, rerender } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );
    expect(
      getByText("Aucune compétition à venir ne correspond à votre profil."),
    ).toBeTruthy();
    // Bêta : rappelle que les inscriptions FFD ne remontent pas dans l'app.
    expect(getByText(BETA_NOTICES.competitionsEmptyHint)).toBeTruthy();

    // Club « Les nôtres » vide → message dédié club.
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, role: "CLUB", scope: "FOR_ME", competitions: [] },
      actions: mockActions,
    });
    await rerender(<CompetitionsScreen {...createTestProps()} />);
    expect(
      getByText("Votre club n'organise aucune compétition pour ce filtre."),
    ).toBeTruthy();
    expect(queryByTestId("competitions-empty-beta-hint")).toBeNull();
  });

  it("rend les cartes LIVE + club (badge organisateur, membres, distance)", async () => {
    const comps = [
      {
        id: "live1",
        title: "Live Comp",
        status: "LIVE",
        date: "2026-08-01T10:00:00.000Z",
        location: "Lyon",
        address: "Rue de la Danse",
        latitude: 45.7,
        longitude: 4.8,
        isOrganizedByMyClub: true,
        clubMembersRegisteredCount: 3,
      },
      {
        id: "up1",
        title: "Upcoming Comp",
        status: "UPCOMING",
        date: "2026-09-01T10:00:00.000Z",
        location: "Paris",
        latitude: 48.85,
        longitude: 2.35,
        registrationDeadline: "2026-08-25T00:00:00.000Z",
      },
    ];
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        role: "CLUB",
        competitions: comps,
        userLocation: { latitude: 45.75, longitude: 4.85 },
      },
      actions: mockActions,
    });

    const { getByText } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );
    expect(getByText("Live Comp")).toBeTruthy();
    expect(getByText("Upcoming Comp")).toBeTruthy();
    expect(getByText("J'organise")).toBeTruthy();
    expect(getByText("3 membre(s) du club inscrit(s)")).toBeTruthy();
  });

  it("ouvre la feuille de filtres et applique discipline / style / distance / dates", async () => {
    (useCompetitionsLogic as jest.Mock).mockReturnValue({
      state: mockState,
      actions: mockActions,
    });

    const { getByTestId } = await render(
      <CompetitionsScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("competitions-filter-button"));
    await fireEvent.press(getByTestId("competitions-filter-discipline-COUPLE"));
    await fireEvent.press(getByTestId("competitions-filter-style-Latin"));
    await fireEvent.changeText(
      getByTestId("competitions-filter-distance-custom"),
      "42",
    );
    await fireEvent.press(getByTestId("competitions-filter-distance-50"));
    await fireEvent.press(getByTestId("competitions-filter-period-MONTH"));
    await fireEvent.press(getByTestId("competitions-filter-date-from"));
    await fireEvent.press(getByTestId("competitions-filter-date-to"));

    expect(mockActions.setDisciplineFilter).toHaveBeenCalled();
    expect(mockActions.setStyleFilter).toHaveBeenCalled();
    expect(mockActions.setMaxDistanceKm).toHaveBeenCalledWith(42);
    expect(mockActions.setDatePeriod).toHaveBeenCalledWith("MONTH");
  });

  describe("loading indicators", () => {
    const competitions = [
      {
        id: "c1",
        title: "Comp A",
        date: new Date().toISOString(),
        location: "Paris",
        status: "UPCOMING",
      },
    ];

    afterEach(async () => {
      await act(() => {
        useWakeStore.setState({ waking: false, visible: false });
      });
    });

    it("shows a single spinner and no empty state on the initial load", async () => {
      (useCompetitionsLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          isLoading: true,
          isLoadingMore: false,
          hasMore: true,
        },
        actions: mockActions,
      });

      const { getByTestId, queryByTestId, queryByText } = await render(
        <CompetitionsScreen {...createTestProps()} />,
      );

      expect(getByTestId("competitions-loading")).toBeTruthy();
      expect(queryByTestId("competitions-load-more")).toBeNull();
      // The "nothing found" message must not flash while pages are scanned.
      expect(queryByText("Aucune compétition")).toBeNull();
    });

    // (FlashList renders no footer under jest — the footer itself is driven by
    // `isLoadingMore` only, see ListFooter.)
    it("keeps the full-screen loader off when paginating under visible rows", async () => {
      (useCompetitionsLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          competitions,
          isLoading: false,
          isLoadingMore: true,
          hasMore: true,
        },
        actions: mockActions,
      });

      const { queryByTestId } = await render(
        <CompetitionsScreen {...createTestProps()} />,
      );

      expect(queryByTestId("competitions-loading")).toBeNull();
    });

    it("hides its own loader while the wake overlay is displayed", async () => {
      await act(() => {
        useWakeStore.setState({ waking: true, visible: true });
      });
      (useCompetitionsLogic as jest.Mock).mockReturnValue({
        state: { ...mockState, isLoading: true, hasMore: true },
        actions: mockActions,
      });

      const { queryByTestId } = await render(
        <CompetitionsScreen {...createTestProps()} />,
      );

      expect(queryByTestId("competitions-loading")).toBeNull();
    });
  });
});
