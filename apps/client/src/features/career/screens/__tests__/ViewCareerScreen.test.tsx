import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { useCareerUserLogic } from "../../hooks/useCareerUserLogic";
import { ViewCareerScreen } from "../ViewCareerScreen";

jest.mock("../../../../context/ThemeContext");
jest.mock("../../hooks/useCareerUserLogic");
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("lucide-react-native", () => {
  const { Text } = require("react-native");
  return {
    ArrowLeft: () => null,
    ChevronLeft: () => null,
    Award: () => null,
    Calendar: () => null,
    MapPin: () => null,
    Trophy: () => <Text>Trophy</Text>,
    Users: () => null,
    Search: () => null,
    X: () => null,
  };
});
jest.mock("../../../../components/AppText");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockUseCareerUserLogic = useCareerUserLogic as jest.MockedFunction<
  typeof useCareerUserLogic
>;

const theme = {
  background: "#fff",
  surface: "#f7f7f7",
  text: "#111",
  textSecondary: "#666",
  border: "#e0e0e0",
  primary: "#004481",
  statusBarStyle: "dark-content" as const,
};

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

function makeRoute(userId: string, userName?: string) {
  return { params: { userId, userName } } as any;
}

const emptyLogic = {
  partnerships: [],
  registrations: [],
  results: [],
  loading: false,
  refresh: jest.fn().mockResolvedValue(undefined),
};

describe("ViewCareerScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme } as unknown as ThemeContextType);
    mockUseCareerUserLogic.mockReturnValue(emptyLogic);
  });

  it("renders the user name in the header", async () => {
    const { getByText } = await render(
      <ViewCareerScreen
        navigation={mockNavigation}
        route={makeRoute("u1", "Jean Dupont")}
      />,
    );
    expect(getByText("Carrière de Jean Dupont")).toBeTruthy();
  });

  it("falls back to 'Ce licencié' when userName is blank", async () => {
    const { getByText } = await render(
      <ViewCareerScreen
        navigation={mockNavigation}
        route={makeRoute("u1", "  ")}
      />,
    );
    expect(getByText("Carrière de Ce licencié")).toBeTruthy();
  });

  it("passes userId to useCareerUserLogic", async () => {
    await render(
      <ViewCareerScreen
        navigation={mockNavigation}
        route={makeRoute("user-42", "Test")}
      />,
    );
    expect(mockUseCareerUserLogic).toHaveBeenCalledWith("user-42");
  });

  it("calls navigation.goBack when back button is pressed", async () => {
    const { getByLabelText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    await fireEvent.press(getByLabelText("Retour"));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it("shows empty state message when no partnerships", async () => {
    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("Aucun partenaire enregistré.")).toBeTruthy();
  });

  it("shows empty state message when no registrations", async () => {
    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("Aucune inscription à une compétition.")).toBeTruthy();
  });

  it("shows empty state message when no results", async () => {
    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("Aucun résultat enregistré pour le moment.")).toBeTruthy();
  });

  it("renders partnership cards", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      partnerships: [
        {
          id: "p1",
          status: "ACTIVE",
          startDate: "2024-01-01T00:00:00.000Z",
          endDate: null,
          partner: {
            id: "u2",
            firstName: "Marie",
            lastName: "Martin",
            clubName: "Club A",
          },
          clubName: "Club A",
          secondaryClubName: null,
          isCurrent: true,
        },
      ],
    });

    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("Marie Martin")).toBeTruthy();
    expect(getByText("Actuel")).toBeTruthy();
  });

  it("renders registration cards and navigates on press", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      registrations: [
        {
          id: "r1",
          status: "CONFIRMED",
          bibNumber: 42,
          partnerName: null,
          event: {
            id: "e1",
            category: "Standard",
            ageGroup: "Adultes",
            level: null,
          },
          competition: {
            id: "c1",
            title: "Coupe de France",
            date: "2025-03-01",
            location: "Paris",
            status: "PUBLISHED",
          },
        },
      ],
    });

    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("Coupe de France")).toBeTruthy();
    await fireEvent.press(getByText("Coupe de France"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("CompetitionDetail", {
      competitionId: "c1",
    });
  });

  it("renders result cards with ranking", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      results: [
        {
          id: "res1",
          eventId: "e1",
          round: "Finale",
          // Off-podium rank: the badge shows the numeric ranking (ranks 1-3
          // now show a trophy instead — covered by the podium test below).
          ranking: 5,
          participantLabel: null,
          event: { category: "Standard", ageGroup: "Adultes" },
          competition: {
            id: "comp-paris",
            title: "Open de Paris",
            date: "2025-04-01",
          },
        },
      ],
    });

    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("5")).toBeTruthy();
    expect(getByText("Open de Paris")).toBeTruthy();
  });

  it("navigates to competition results (LiveResults) when a result row is pressed", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      results: [
        {
          id: "res-nav",
          eventId: "e1",
          round: "Finale",
          ranking: 2,
          participantLabel: null,
          event: { category: "Standard", ageGroup: "Adultes" },
          competition: {
            id: "comp-nav",
            title: "Trophée National",
            date: "2025-06-01",
          },
        },
      ],
    });

    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    await fireEvent.press(getByText("Trophée National"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("LiveResults", {
      competitionId: "comp-nav",
    });
  });

  it("shows a trophy on a podium result (matches the LiveResults screen)", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      results: [
        {
          id: "res-gold",
          eventId: "e1",
          round: "Finale",
          ranking: 1,
          participantLabel: null,
          event: { category: "Latin", ageGroup: "Adultes" },
          competition: {
            id: "comp-gp",
            title: "Grand Prix",
            date: "2025-05-01",
          },
        },
      ],
    });

    const { getByText, queryByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    // Founder decision (beta QA): the podium badge mirrors the results screen —
    // a trophy icon replaces the rank number for ranks 1-3.
    expect(getByText("Trophy")).toBeTruthy();
    expect(queryByText("1")).toBeNull();
  });

  it("keeps the default white-on-primary badge for an off-podium result", async () => {
    mockUseCareerUserLogic.mockReturnValue({
      ...emptyLogic,
      results: [
        {
          id: "res-off",
          eventId: "e1",
          round: "Finale",
          ranking: 7,
          participantLabel: null,
          event: { category: "Latin", ageGroup: "Adultes" },
          competition: {
            id: "comp-lyon",
            title: "Open de Lyon",
            date: "2025-05-01",
          },
        },
      ],
    });

    const { getByText } = await render(
      <ViewCareerScreen navigation={mockNavigation} route={makeRoute("u1")} />,
    );
    expect(getByText("7")).toHaveStyle({ color: "#FFFFFF" });
  });
});
