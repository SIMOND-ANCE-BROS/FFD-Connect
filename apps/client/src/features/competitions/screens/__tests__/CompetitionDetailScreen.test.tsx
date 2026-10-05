import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert, Linking } from "react-native";
import type {
  MockComponentProps,
  MockFluidSegmentedTabProps,
} from "../../../../__tests__/mocks/types";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useCompetitionDetailLogic } from "../../hooks/useCompetitionDetailLogic";
import { CompetitionDetailScreen } from "../CompetitionDetailScreen";

// Mock dependencies
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));
jest.mock("../../hooks/useCompetitionDetailLogic");

jest.mock("../../../../components/FluidSegmentedTab", () => {
  const { TouchableOpacity, Text } = require("react-native");
  return {
    FluidSegmentedTab: ({ options, onChange }: MockFluidSegmentedTabProps) => (
      <>
        {options.map((opt) => (
          <TouchableOpacity
            accessibilityRole="button"
            key={opt.value}
            onPress={() => onChange(opt.value)}
            testID={`tab-${opt.value}`}
          >
            <Text>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </>
    ),
  };
});
jest.mock("../../../../components/AppButton");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockUseLogic = useCompetitionDetailLogic as jest.MockedFunction<
  typeof useCompetitionDetailLogic
>;

const mockTheme = {
  background: "#FFFFFF",
  text: "#000000",
  textSecondary: "#666666",
  primary: "#007AFF",
  surface: "#F5F5F5",
  border: "#C7C7CC",
  danger: "#FF3B30",
  secondary: "#FFCC00",
  accent: "#5856D6",
  inputBackground: "#EFEFF4",
  statusBarStyle: "dark-content" as const,
  dark: false,
  success: "#4CD964",
  warning: "#FF9500",
  colors: {
    primary: "#007AFF",
    secondary: "#FFCC00",
    background: "#FFFFFF",
    surface: "#F5F5F5",
    text: "#000000",
    textSecondary: "#666666",
    border: "#C7C7CC",
    error: "#FF3B30",
    warning: "#FF9500",
  },
} as never;

const mockCompetition = {
  id: "c1",
  title: "Championnat de France",
  date: "2026-10-10",
  city: "Lyon",
  location: "Palais des Sports",
  organizer: "Comité Régional",
  status: "UPCOMING" as "UPCOMING" | "LIVE" | "PAST" | "CANCELLED",
  events: [
    {
      id: "e1",
      category: "Latin",
      dance: "Samba",
      ageGroup: "Senior",
      competitionId: "c1",
    },
    {
      id: "e2",
      category: "Standard",
      dance: "Waltz",
      ageGroup: "Senior",
      competitionId: "c1",
    },
  ],
  myRegistrations: [],
  schedule: [],
  latitude: 45.75,
  longitude: 4.85,
  delayMinutes: 0,
};

const baseState = {
  loading: false,
  details: mockCompetition,
  myRegistrations: [] as string[],
  pendingRegistrationActions: {} as Record<string, "register" | "unregister">,
  userRole: "LICENSEE" as const,
  clubMembers: [],
  selectedEventForRegistration: null,
  isGuest: false,
  isOrganizedByMyClub: false,
  partnerInputEvent: null,
  clubRegistrationMode: undefined,
  pendingRegistrationsForCompetition: [],
  showPendingSection: false,
  isRegisteringMembers: false,
  canSelfRegister: true,
};

const baseActions = {
  isEligible: () => ({ eligible: true }),
  handleRegister: jest.fn(),
  handleUnregister: jest.fn(),
  setSelectedEventForRegistration: jest.fn(),
  handleConfirmPartnerRegistration: jest.fn(),
  clearPartnerInput: jest.fn(),
  handleRegisterMembers: jest.fn(),
  handleConfirmRegistration: jest.fn(),
  handleUnregisterMember: jest.fn(),
};

describe("CompetitionDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({
      theme: mockTheme,
      isDark: false,
      setPreference: jest.fn().mockResolvedValue(undefined),
      preference: "system",
      animationsEnabled: true,
      toggleAnimations: jest.fn().mockResolvedValue(undefined),
    });
    jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve(true));
    jest.spyOn(Alert, "alert");
  });

  const createTestProps = () =>
    createMockScreenProps("CompetitionDetail", { competitionId: "c1" });

  it("renders loading state", async () => {
    mockUseLogic.mockReturnValue({
      state: {
        ...baseState,
        loading: true,
        details: undefined,
      },
      actions: baseActions,
    });

    const { getByTestId } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    expect(getByTestId("competition-detail-loading")).toBeTruthy();
  });

  it("renders competition details correctly", async () => {
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: baseActions,
    });

    const { getByText } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    expect(getByText("Championnat de France")).toBeTruthy();
    expect(getByText("Lyon")).toBeTruthy();
    expect(getByText("Latin")).toBeTruthy();
  });

  it("switches tabs", async () => {
    mockUseLogic.mockReturnValue({
      state: {
        ...baseState,
        details: { ...mockCompetition, schedule: [] },
      },
      actions: baseActions,
    });

    const { getByText, getByTestId } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    expect(getByTestId("competition-detail-events-list")).toBeTruthy();

    await fireEvent.press(getByText("Timing"));
    expect(getByTestId("competition-detail-timing-list")).toBeTruthy();
  });

  it("calls register action when eligible and not registered", async () => {
    const handleRegister = jest.fn();
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: {
        ...baseActions,
        handleRegister,
      },
    });

    const { getByTestId } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("register-event-e1"));
    expect(handleRegister).toHaveBeenCalled();
  });

  it("calls unregister action when already registered", async () => {
    const handleUnregister = jest.fn();
    mockUseLogic.mockReturnValue({
      state: {
        ...baseState,
        myRegistrations: ["e1"],
      },
      actions: {
        ...baseActions,
        handleUnregister,
      },
    });

    const { getByText } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByText("Désinscrire"));
    expect(handleUnregister).toHaveBeenCalled();
  });

  it("renders disabled state when not eligible", async () => {
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: {
        ...baseActions,
        isEligible: (event: { id: string }) =>
          event.id === "e1"
            ? { eligible: false, reason: "WRONG_CATEGORY" }
            : { eligible: true },
      },
    });

    const { getByText, queryByTestId } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    expect(getByText("Non éligible")).toBeTruthy();
    expect(queryByTestId("register-event-e1")).toBeNull(); // Should not show register button
  });

  it("renders organizer-of-competition UI with Inscrire", async () => {
    mockUseLogic.mockReturnValue({
      state: {
        ...baseState,
        userRole: "CLUB",
        isOrganizedByMyClub: true,
      },
      actions: baseActions,
    });

    const { getAllByText } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    // Organiser du club voit "Inscrits" (liste) et "Inscrire" (inscrire des membres), pas "Gérer"
    expect(getAllByText("Inscrits").length).toBeGreaterThan(0);
    expect(getAllByText("Inscrire").length).toBeGreaterThan(0);
  });

  it("handles GPS navigation interactions", async () => {
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: baseActions,
    });

    const { getByText } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByText("S'y rendre"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Choisir une application GPS",
      "Laquelle souhaitez-vous utiliser ?",
      expect.any(Array),
      expect.any(Object),
    );

    // Simulate selection of Google Maps (assuming it's the 2nd option for example, or we inspect calls)
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const options = alertCalls[0][2];
    const googleMapsOption = options.find(
      (opt: { text: string }) => opt.text === "Google Maps",
    );

    if (googleMapsOption?.onPress) {
      await googleMapsOption.onPress();

      expect(Linking.openURL).toHaveBeenCalledWith(
        expect.stringContaining("google.com/maps"),
      );
    }
  });

  it("shows the themed fallback when the static map tile fails to load", async () => {
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: baseActions,
    });

    const { getByText, queryByText, container } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    // The map tile is the only <Image>, identified by its static-maps source.
    const mapTiles = () =>
      container.queryAll((node) => {
        const source = node.props.source as { uri?: string } | undefined;
        return (
          typeof source?.uri === "string" &&
          source.uri.includes("maps.googleapis.com")
        );
      });

    // The static Google map tile renders first; no fallback yet.
    expect(mapTiles()).toHaveLength(1);
    expect(queryByText("Carte indisponible")).toBeNull();

    // Trigger the <Image> onError (absent/badly-scoped key, network failure…).
    await fireEvent(mapTiles()[0], "error");

    // The broken tile is replaced by the themed fallback (title + venue) and
    // the image is no longer rendered.
    expect(getByText("Carte indisponible")).toBeTruthy();
    expect(getByText("Palais des Sports")).toBeTruthy();
    expect(mapTiles()).toHaveLength(0);
  });

  it("handles back navigation", async () => {
    const props = createTestProps();
    mockUseLogic.mockReturnValue({
      state: {
        ...baseState,
        loading: true,
        details: undefined,
      },
      actions: baseActions,
    });

    const { getByTestId } = await render(
      <CompetitionDetailScreen {...props} />,
    );

    await fireEvent.press(getByTestId("back-button"));
    expect(props.navigation.goBack).toHaveBeenCalled();
  });
});
