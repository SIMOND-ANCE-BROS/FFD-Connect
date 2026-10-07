/**
 * MSW Integration Tests for CareerScreen
 *
 * Vérifie le comportement de CareerScreen selon les réponses API :
 * - Affichage des partenariats / inscriptions / résultats
 * - État loading puis rendu des données
 * - Gestion des erreurs API (500)
 * - Réponse vide (carrière sans données)
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { http, HttpResponse } from "msw";
import React from "react";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";
import { server } from "../../../../mocks/msw/server";
import { mockCareer } from "../../../../mocks/msw/handlers";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { CareerScreen } from "../CareerScreen";

// ─── Mock hooks & contexts ────────────────────────────────────────────────────

jest.mock("../../hooks/useCareerLogic");
jest.mock("../../hooks/useCareerUserLogic");

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () =>
    (
      require("../../../../__tests__/mocks/mockTheme") as typeof import("../../../../__tests__/mocks/mockTheme")
    ).mockUseTheme(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock(
  "../../context/AuthContext",
  () => ({
    useAuthRepository: () => ({
      getAuthConfig: jest.fn().mockResolvedValue({
        authToken: "mock-token",
        isLoggedIn: true,
        role: "LICENSEE",
      }),
    }),
  }),
  { virtual: true },
);

jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: () => ({
    getAuthConfig: jest.fn().mockResolvedValue({
      authToken: "mock-token",
      isLoggedIn: true,
      role: "LICENSEE",
    }),
  }),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () =>
    (
      require("../../../../__tests__/mocks/mockNavigation") as typeof import("../../../../__tests__/mocks/mockNavigation")
    ).mockNavigation,
}));

// ─── Mock UI components ───────────────────────────────────────────────────────

jest.mock("../../../../components/AppText");

// NotificationBell relies on React Query (unread count) — out of scope here.
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

jest.mock("lucide-react-native", () => {
  const { Text } = require("react-native");
  return {
    Award: () => <Text>Award</Text>,
    Bell: () => <Text>Bell</Text>,
    Calendar: () => <Text>Calendar</Text>,
    MapPin: () => <Text>MapPin</Text>,
    Search: () => <Text>Search</Text>,
    Trophy: () => <Text>Trophy</Text>,
    User: () => <Text>User</Text>,
    Users: () => <Text>Users</Text>,
    X: () => <Text>X</Text>,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ─── Shared setup ─────────────────────────────────────────────────────────────

const { useCareerLogic } = require("../../hooks/useCareerLogic") as {
  useCareerLogic: jest.Mock;
};

const makeCareerState = (overrides = {}) => ({
  partnerships: mockCareer.partnerships,
  registrations: mockCareer.registrations,
  results: mockCareer.results,
  loading: false,
  refresh: jest.fn(),
  ...overrides,
});

const props = createMockScreenProps<"Career">({} as never);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CareerScreen (MSW)", () => {
  // ScrollView has a heavy one-time mock: load it outside the first test's
  // timeout (flaky under full-suite load otherwise).
  preloadReactNative("ScrollView");

  it("affiche les données de carrière quand l'API répond avec succès", async () => {
    useCareerLogic.mockReturnValue(makeCareerState());

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Carrière")).toBeTruthy();
    });
  });

  it("affiche 'Carrière' comme titre", async () => {
    useCareerLogic.mockReturnValue(makeCareerState());

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Carrière")).toBeTruthy();
    });
  });

  it("affiche la section Partenariats", async () => {
    useCareerLogic.mockReturnValue(makeCareerState());

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Partenariats")).toBeTruthy();
    });
  });

  it("affiche un ActivityIndicator pendant le chargement", async () => {
    useCareerLogic.mockReturnValue(
      makeCareerState({
        loading: true,
        partnerships: [],
        registrations: [],
        results: [],
      }),
    );

    const { getByTestId } = await render(<CareerScreen {...props} />);

    // Le loading spinner doit être présent quand loading=true et pas de données
    await waitFor(() => {
      expect(getByTestId("career-loading")).toBeTruthy();
    });
  });

  it("affiche les sections vides si l'API retourne une carrière vide", async () => {
    server.use(
      http.get("http://localhost:3000/career/me", () => {
        return HttpResponse.json({
          partnerships: [],
          registrations: [],
          results: [],
        });
      }),
    );

    useCareerLogic.mockReturnValue(
      makeCareerState({ partnerships: [], registrations: [], results: [] }),
    );

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Carrière")).toBeTruthy();
    });
  });

  it("gère une erreur 500 de l'API sans planter", async () => {
    server.use(
      http.get("http://localhost:3000/career/me", () => {
        return HttpResponse.json(
          { message: "Internal server error" },
          { status: 500 },
        );
      }),
    );

    useCareerLogic.mockReturnValue(
      makeCareerState({
        partnerships: [],
        registrations: [],
        results: [],
        loading: false,
      }),
    );

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Carrière")).toBeTruthy();
    });
  });

  it("affiche le contenu des partenariats quand ils existent", async () => {
    useCareerLogic.mockReturnValue(makeCareerState());

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      // Partner firstName from mockCareer
      expect(getByText(/Partner/i)).toBeTruthy();
    });
  });

  it("affiche les sections d'inscriptions et résultats", async () => {
    useCareerLogic.mockReturnValue(makeCareerState());

    const { getAllByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      const matches = getAllByText(/Championnats|Latin|Adulte|Compétitions/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  // ─── Podium palmarès (#136 / PR #688) ─────────────────────────────────────
  // Régression : le palmarès du licencié lui-même (CareerScreen) applique les
  // badges podium via getPodiumStyle, mais seul ViewCareerScreen était couvert.
  // On isole un seul résultat (partenariats/inscriptions vides) pour que le
  // seul nœud texte "1"/"7" soit le numéro de rang du badge.
  const makePodiumResult = (ranking: number) => ({
    id: `res-${ranking}`,
    eventId: "e1",
    round: "Finale",
    ranking,
    participantLabel: null,
    totalParticipants: 12,
    event: { id: "e1", category: "Latin", ageGroup: "Adulte", level: null },
    competition: {
      id: "c1",
      title: "Grand Prix",
      date: "2025-05-01",
      location: "Paris",
      status: "PUBLISHED",
    },
  });

  it("affiche un trophée (comme les Résultats) pour un rang podium", async () => {
    useCareerLogic.mockReturnValue(
      makeCareerState({
        partnerships: [],
        registrations: [],
        results: [makePodiumResult(1)],
      }),
    );

    const { getByText, queryByText } = await render(
      <CareerScreen {...props} />,
    );

    // Décision fondateur (QA beta) : le badge podium doit être identique à
    // l'écran Résultats → icône trophée à la place du numéro de rang.
    await waitFor(() => {
      expect(getByText("Trophy")).toBeTruthy();
    });
    // Le numéro n'est plus rendu dans le badge podium (remplacé par le trophée).
    expect(queryByText("1")).toBeNull();
  });

  it("garde le badge blanc-sur-primary hors podium (rang > 3)", async () => {
    useCareerLogic.mockReturnValue(
      makeCareerState({
        partnerships: [],
        registrations: [],
        results: [makePodiumResult(7)],
      }),
    );

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("7")).toHaveStyle({ color: "#FFFFFF" });
    });
  });

  // Le badge podium affiche désormais un trophée (parité avec l'écran
  // Résultats) ; hors podium, on garde le numéro avec le poids historique du
  // variant h3 (aucune prop weight). Le mock d'AppText retransmet `weight`.
  it("trophée sur le podium, numéro au poids h3 historique hors podium", async () => {
    useCareerLogic.mockReturnValue(
      makeCareerState({
        partnerships: [],
        registrations: [],
        results: [makePodiumResult(1), makePodiumResult(5)],
      }),
    );

    const { getByText, queryByText } = await render(
      <CareerScreen {...props} />,
    );

    await waitFor(() => {
      expect(getByText("5")).toBeTruthy();
    });
    // Podium (rang 1) : trophée, aucun numéro dans le badge.
    expect(getByText("Trophy")).toBeTruthy();
    expect(queryByText("1")).toBeNull();
    // Hors podium (rang 5) : pas de surcharge de poids → look h3 historique.
    expect(getByText("5").props.weight).toBeUndefined();
  });

  // Navigation depuis le palmarès (#699 / QA beta) : une ligne de résultat
  // ouvre les RÉSULTATS de la compétition (route LiveResults) via le stack
  // parent (getParent().navigate), en miroir de ViewCareerScreen.
  it("ouvre les résultats (LiveResults) au press d'une ligne de résultat", async () => {
    const parentNavigate = jest.fn();
    (props.navigation.getParent as unknown as jest.Mock).mockReturnValue({
      navigate: parentNavigate,
    });

    useCareerLogic.mockReturnValue(
      makeCareerState({
        partnerships: [],
        registrations: [],
        results: [makePodiumResult(3)],
      }),
    );

    const { getByText } = await render(<CareerScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Grand Prix")).toBeTruthy();
    });

    await fireEvent.press(getByText("Grand Prix"));

    expect(parentNavigate).toHaveBeenCalledWith("LiveResults", {
      competitionId: "c1",
    });
  });
});
