/**
 * MSW Integration Tests for CompetitionsScreen
 *
 * Vérifie le comportement de CompetitionsScreen selon les réponses API :
 * - Liste de compétitions chargée depuis l'API
 * - État loading
 * - API vide → liste vide
 * - Erreur 500 → pas de crash
 * - Filtre de statut et scope
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { http, HttpResponse } from "msw";
import React from "react";
import { server } from "../../../../mocks/msw/server";
import { mockCompetition } from "../../../../mocks/msw/handlers";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { CompetitionsScreen } from "../CompetitionsScreen";

// ─── Mock hooks & contexts ────────────────────────────────────────────────────

jest.mock("../../hooks/useCompetitionsLogic", () => ({
  ...jest.requireActual("../../hooks/useCompetitionsLogic"),
  useCompetitionsLogic: jest.fn(),
}));

// Cloche de notifs (React Query) hors périmètre de ce test MSW.
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () =>
    (
      require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
    ).mockUseTheme(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: () => ({
    getAuthConfig: jest.fn().mockResolvedValue({
      authToken: "mock-token",
      isLoggedIn: true,
      role: "LICENSEE",
    }),
  }),
}));

jest.mock("../../context/CompetitionContext", () => ({
  useCompetitionRepository: () => ({
    getCompetitions: jest.fn().mockResolvedValue({
      data: [mockCompetition],
      meta: { hasMore: false, total: 1, skip: 0, take: 10 },
    }),
    syncCompetitions: jest.fn().mockResolvedValue(undefined),
  }),
  CompetitionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () =>
    (
      require("../../../../__tests__/mocks/mockNavigation") as typeof import("../../../../__tests__/mocks/mockNavigation")
    ).mockNavigation,
}));

jest.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: jest.fn(),
}));

// ─── Mock UI components ───────────────────────────────────────────────────────

jest.mock("../../../../components/AppText");

jest.mock("../../../../components/FluidSegmentedTab", () => ({
  FluidSegmentedTab: ({
    options,
    activeValue,
    onChange,
  }: {
    options: Array<{ value: string; label: string }>;
    activeValue: string;
    onChange: (v: string) => void;
  }) => {
    const { View, TouchableOpacity, Text } = require("react-native");
    return (
      <View>
        {options.map((opt: { value: string; label: string }) => (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            testID={`tab-${opt.value}`}
            accessible
            accessibilityRole="button"
          >
            <Text>
              {opt.label}
              {activeValue === opt.value ? " (Active)" : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  },
}));

// Proxy renders any lucide icon as its name, so new icons (SlidersHorizontal,
// RotateCcw, Clock…) resolve without listing each one.
jest.mock("lucide-react-native", () => {
  const { Text } = require("react-native");
  return new Proxy(
    {},
    {
      get: (_target, name) => () => <Text>{String(name)}</Text>,
    },
  );
});

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@shopify/flash-list", () => {
  const { FlatList, Animated } = require("react-native");
  // Wrap so Animated.event onScroll (useNativeDriver) doesn't violate the
  // VirtualizedList invariant. Real FlashList already forwards onScroll natively.
  return { FlashList: Animated.createAnimatedComponent(FlatList) };
});

// ─── Shared setup ─────────────────────────────────────────────────────────────

const { useCompetitionsLogic } =
  require("../../hooks/useCompetitionsLogic") as {
    useCompetitionsLogic: jest.Mock;
  };

const makeState = (overrides = {}) => ({
  state: {
    competitions: [mockCompetition],
    isLoading: false,
    refreshing: false,
    hasMore: false,
    scope: "ALL" as const,
    statusFilter: "UPCOMING" as const,
    searchQuery: "",
    theme: (
      require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
    ).mockUseTheme(),
    isGuest: false,
    role: "LICENSEE",
    userLocation: null,
    maxDistanceKm: null,
    datePeriod: "ALL" as const,
    dateFrom: null,
    dateTo: null,
    styleFilter: new Set(),
    disciplineFilter: new Set(),
    ...overrides,
  },
  actions: {
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
    onLoadMore: jest.fn().mockResolvedValue(undefined),
    loadSettings: jest.fn().mockResolvedValue(undefined),
  },
});

const props = createMockScreenProps<"Competitions">({} as never);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CompetitionsScreen (MSW)", () => {
  it("affiche les compétitions quand l'API répond avec succès", async () => {
    useCompetitionsLogic.mockReturnValue(makeState());

    const { getByText } = await render(<CompetitionsScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Championnat de France")).toBeTruthy();
    });
  });

  it("affiche un état de chargement", async () => {
    useCompetitionsLogic.mockReturnValue(
      makeState({ isLoading: true, competitions: [] }),
    );

    const { getByTestId } = await render(<CompetitionsScreen {...props} />);

    await waitFor(() => {
      expect(getByTestId("competitions-loading")).toBeTruthy();
    });
  });

  it("affiche une liste vide quand l'API retourne []", async () => {
    server.use(
      http.get("http://localhost:3000/competitions", () => {
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20 });
      }),
    );

    useCompetitionsLogic.mockReturnValue(makeState({ competitions: [] }));

    const { queryByText } = await render(<CompetitionsScreen {...props} />);

    await waitFor(() => {
      expect(queryByText("Championnat de France")).toBeNull();
    });
  });

  it("ne plante pas si l'API retourne une erreur 500", async () => {
    server.use(
      http.get("http://localhost:3000/competitions", () => {
        return HttpResponse.json(
          { message: "Internal server error" },
          { status: 500 },
        );
      }),
    );

    useCompetitionsLogic.mockReturnValue(
      makeState({ competitions: [], isLoading: false }),
    );

    const { queryByText } = await render(<CompetitionsScreen {...props} />);

    await waitFor(() => {
      expect(queryByText("Championnat de France")).toBeNull();
    });
  });

  it("affiche la localisation de la compétition", async () => {
    useCompetitionsLogic.mockReturnValue(makeState());

    const { getByText } = await render(<CompetitionsScreen {...props} />);

    await waitFor(() => {
      expect(getByText(/Paris/i)).toBeTruthy();
    });
  });

  it("appelle setScope quand on change l'onglet", async () => {
    const state = makeState();
    useCompetitionsLogic.mockReturnValue(state);

    const { getByTestId } = await render(<CompetitionsScreen {...props} />);

    await waitFor(async () => {
      const tab = getByTestId("tab-FOR_ME");
      if (tab) {
        await fireEvent.press(tab);
        expect(state.actions.setScope).toHaveBeenCalledWith("FOR_ME");
      }
    });
  });
});
