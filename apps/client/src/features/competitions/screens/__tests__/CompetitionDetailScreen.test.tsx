import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert, Linking } from "react-native";
import type {
  MockComponentProps,
  MockFluidSegmentedTabProps,
} from "../../../../__tests__/mocks/types";
import {
  BETA_NOTICES,
  EVENTS_SOURCE_NOTICES,
} from "../../../../constants/betaNotices";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useCompetitionDetailLogic } from "../../hooks/useCompetitionDetailLogic";
import { CompetitionDetailScreen } from "../CompetitionDetailScreen";
import { useCurrentPartner } from "../../../career/hooks/useCurrentPartner";
import type { UserRole } from "../../../auth/context/AuthContext";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Mock dependencies
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));
jest.mock("../../hooks/useCompetitionDetailLogic");
jest.mock("../../../career/hooks/useCurrentPartner", () => ({
  useCurrentPartner: jest.fn(() => ({ status: "unknown" })),
}));

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

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative(
  "ScrollView",
  "Image",
  "Alert",
  "ActivityIndicator",
  "Switch",
  // Partner modal (#858).
  "Modal",
  "TextInput",
);

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
    expect(getByText("Latines")).toBeTruthy();
  });

  it("shows the beta notice (informative only, FFD registrations not shown)", async () => {
    mockUseLogic.mockReturnValue({
      state: baseState,
      actions: baseActions,
    });

    const { getByTestId, getByText } = await render(
      <CompetitionDetailScreen {...createTestProps()} />,
    );

    expect(getByTestId("competition-detail-beta-notice")).toBeTruthy();
    expect(getByText(BETA_NOTICES.competitions.message)).toBeTruthy();
  });

  describe("events source notice", () => {
    const CIRCULAR = "https://example.org/circulaire.pdf";
    const renderWith = async (extra: Record<string, unknown>) => {
      mockUseLogic.mockReturnValue({
        state: {
          ...baseState,
          details: { ...mockCompetition, ffdId: "ffd-1", ...extra },
        },
        actions: baseActions,
      });
      return render(<CompetitionDetailScreen {...createTestProps()} />);
    };

    it("flags events deduced from the circular and opens it", async () => {
      const { getByText, getByTestId, getByLabelText } = await renderWith({
        eventsSource: "CIRCULAR",
        circularUrl: CIRCULAR,
      });

      expect(
        getByText(EVENTS_SOURCE_NOTICES.deducedFromCircular.message),
      ).toBeTruthy();
      await fireEvent.press(getByLabelText("Ouvrir la circulaire"));
      expect(Linking.openURL).toHaveBeenCalledWith(CIRCULAR);
      // Deduced events are real: they are listed.
      expect(getByTestId("competition-detail-events-list")).toBeTruthy();
    });

    // One circular button only (the programme block's), not one per block.
    it.each(["CIRCULAR", "DESCRIPTION", "GENERIC"])(
      "offers a single circular button (%s)",
      async (eventsSource) => {
        const { getAllByLabelText } = await renderWith({
          eventsSource,
          circularUrl: CIRCULAR,
        });

        expect(getAllByLabelText("Ouvrir la circulaire")).toHaveLength(1);
      },
    );

    it("flags events deduced from the description", async () => {
      const { getByText, getByTestId } = await renderWith({
        eventsSource: "DESCRIPTION",
        circularUrl: CIRCULAR,
      });

      expect(
        getByText(EVENTS_SOURCE_NOTICES.deducedFromDescription.message),
      ).toBeTruthy();
      expect(getByTestId("competition-detail-events-list")).toBeTruthy();
    });

    it("points to the circular when its events could not be read", async () => {
      const { getByText, getByLabelText } = await renderWith({
        eventsSource: "GENERIC",
        circularUrl: CIRCULAR,
      });

      expect(
        getByText(EVENTS_SOURCE_NOTICES.circularUnreadable.message),
      ).toBeTruthy();
      expect(getByLabelText("Ouvrir la circulaire")).toBeTruthy();
    });

    // The sync seeds placeholder events (Standard/Latin × Adult/Senior) until
    // the real ones are read: they are not shown as if they were real.
    it.each([["GENERIC"], [null], [undefined]])(
      "does not list placeholder events (source %s)",
      async (eventsSource) => {
        const { queryByTestId, queryByText } = await renderWith({
          eventsSource,
          circularUrl: CIRCULAR,
        });

        expect(queryByTestId("competition-detail-events-list")).toBeNull();
        expect(queryByText("Latines")).toBeNull();
      },
    );

    it("keeps one results entry when placeholder events are hidden", async () => {
      const props = createTestProps();
      mockUseLogic.mockReturnValue({
        state: {
          ...baseState,
          details: {
            ...mockCompetition,
            ffdId: "ffd-1",
            eventsSource: "GENERIC",
            status: "PAST" as const,
          },
        },
        actions: baseActions,
      });

      const { getByText } = await render(
        <CompetitionDetailScreen {...props} />,
      );

      await fireEvent.press(getByText("Résultats"));
      expect(props.navigation.navigate).toHaveBeenCalledWith("LiveResults", {
        competitionId: "c1",
      });
    });

    it("has no results entry for an upcoming competition", async () => {
      const { queryByText } = await renderWith({ eventsSource: "GENERIC" });

      expect(queryByText("Résultats")).toBeNull();
    });

    it("says events are not published yet when there is no circular (field absent)", async () => {
      const { getByText, queryByLabelText } = await renderWith({});

      expect(
        getByText(EVENTS_SOURCE_NOTICES.notYetPublished.message),
      ).toBeTruthy();
      expect(queryByLabelText("Ouvrir la circulaire")).toBeNull();
    });

    it("shows no notice for a competition not synced from the federation", async () => {
      mockUseLogic.mockReturnValue({ state: baseState, actions: baseActions });

      const { queryByTestId } = await render(
        <CompetitionDetailScreen {...createTestProps()} />,
      );

      expect(queryByTestId("competition-events-source-notice")).toBeNull();
      // Club-created events are authoritative: always listed.
      expect(queryByTestId("competition-detail-events-list")).toBeTruthy();
    });
  });

  // A circular lists one event per level: one card per discipline / age
  // class / type, with a row per level (they looked like duplicates).
  describe("events grouped by level", () => {
    const levels = [
      { id: "l1", eventKind: "OPEN" },
      { id: "l2", eventKind: "CLASSIFICATRICE", level: "Avancé" },
      { id: "l3", eventKind: "CLASSIFICATRICE", level: "Débutant" },
      { id: "l4", eventKind: "CLASSIFICATRICE", level: "Intermédiaire" },
    ].map((o) => ({
      category: "Latin",
      ageGroup: "Junior I",
      eventType: "COUPLE",
      competitionId: "c1",
      ...o,
    }));
    const withLevels = {
      ...mockCompetition,
      ffdId: "ffd-1",
      eventsSource: "CIRCULAR",
      events: levels,
    };

    it("shows one card for the four levels", async () => {
      mockUseLogic.mockReturnValue({
        state: { ...baseState, details: withLevels },
        actions: baseActions,
      });

      const { getAllByText, getByText } = await render(
        <CompetitionDetailScreen {...createTestProps()} />,
      );

      expect(getAllByText("Latines")).toHaveLength(1);
      for (const label of ["Débutant", "Intermédiaire", "Avancé", "Open"]) {
        expect(getByText(label)).toBeTruthy();
      }
    });

    it("hides the levels the dancer cannot enter on demand", async () => {
      mockUseLogic.mockReturnValue({
        state: { ...baseState, details: withLevels },
        actions: {
          ...baseActions,
          isEligible: (event: { id: string }) =>
            event.id === "l2"
              ? { eligible: false, reason: "NOT_ALLOWED" }
              : { eligible: true },
        },
      });

      const { getByTestId, getByText, queryByText } = await render(
        <CompetitionDetailScreen {...createTestProps()} />,
      );

      expect(getByText("Avancé")).toBeTruthy();
      await fireEvent(
        getByTestId("competition-detail-eligible-only"),
        "valueChange",
        true,
      );
      expect(queryByText("Avancé")).toBeNull();
      expect(getByText("Débutant")).toBeTruthy();
    });

    it("offers no filter when every event is open to the dancer", async () => {
      mockUseLogic.mockReturnValue({
        state: { ...baseState, details: withLevels },
        actions: baseActions,
      });

      const { queryByTestId } = await render(
        <CompetitionDetailScreen {...createTestProps()} />,
      );

      expect(queryByTestId("competition-detail-eligible-only")).toBeNull();
    });
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

  describe("seat booking (#453)", () => {
    const PRICED_LAYOUT = [
      {
        id: "t1",
        type: "TABLE",
        label: "Table 1",
        capacity: 6,
        priceCents: 1500,
      },
    ];
    const renderWith = async (
      state: Partial<typeof baseState> & Record<string, unknown>,
      details: Record<string, unknown> = {},
    ) => {
      const props = createTestProps();
      mockUseLogic.mockReturnValue({
        state: {
          ...baseState,
          ...state,
          details: { ...mockCompetition, layout: PRICED_LAYOUT, ...details },
        },
        actions: baseActions,
      });
      const screen = await render(<CompetitionDetailScreen {...props} />);
      return { ...screen, props };
    };

    it("opens the seat picker when seats are for sale", async () => {
      const { getByTestId, props } = await renderWith({});

      await fireEvent.press(getByTestId("competition-detail-seat-booking"));
      expect(props.navigation.navigate).toHaveBeenCalledWith("SeatPicker", {
        competitionId: "c1",
      });
    });

    it.each([
      ["no priced element", {}, { layout: [{ id: "t1", type: "TABLE" }] }],
      ["a guest", { isGuest: true }, {}],
      ["the organising club", { userRole: "CLUB" }, {}],
      ["a past competition", {}, { status: "PAST" }],
    ])("is not offered to %s", async (_label, state, details) => {
      const { queryByTestId } = await renderWith(
        state as Partial<typeof baseState>,
        details,
      );
      expect(queryByTestId("competition-detail-seat-booking")).toBeNull();
    });
  });

  describe("couple event without a registered partner (#858)", () => {
    const mockUseCurrentPartner = useCurrentPartner as jest.MockedFunction<
      typeof useCurrentPartner
    >;
    const renderPartnerModal = async (userRole: UserRole = "LICENSEE") => {
      const props = createTestProps();
      mockUseLogic.mockReturnValue({
        state: {
          ...baseState,
          userRole,
          partnerInputEvent: mockCompetition.events[0],
        },
        actions: baseActions,
      } as never);
      const utils = await render(<CompetitionDetailScreen {...props} />);
      return { props, ...utils };
    };

    afterEach(() =>
      mockUseCurrentPartner.mockReturnValue({ status: "unknown" }),
    );

    it("asks for the partner only for a licensee", async () => {
      await renderPartnerModal();
      expect(mockUseCurrentPartner).toHaveBeenCalledWith(true);
    });

    it.each<UserRole>(["GUEST", "CLUB", "STAFF", "ADMIN"])(
      "never reads the career of a %s (query disabled)",
      async (role) => {
        mockUseCurrentPartner.mockClear();
        await renderPartnerModal(role);
        expect(mockUseCurrentPartner).toHaveBeenCalled();
        expect(mockUseCurrentPartner).not.toHaveBeenCalledWith(true);
      },
    );

    it("names the cause and opens the partner screen (Career tab)", async () => {
      mockUseCurrentPartner.mockReturnValue({ status: "none" });
      const { props, getByText, getByTestId } = await renderPartnerModal();

      expect(getByText("Aucun partenaire enregistré")).toBeTruthy();
      await fireEvent.press(getByTestId("partner-input-manage"));

      expect(baseActions.clearPartnerInput).toHaveBeenCalled();
      expect(props.navigation.popTo).toHaveBeenCalledWith("Main", {
        screen: "Career",
      });
    });

    it("says nothing about a missing partner when one is registered", async () => {
      mockUseCurrentPartner.mockReturnValue({
        status: "registered",
        name: "Jeanne Martin",
      });
      const { queryByTestId, getByDisplayValue } = await renderPartnerModal();

      expect(queryByTestId("partner-input-no-partner")).toBeNull();
      expect(getByDisplayValue("Jeanne Martin")).toBeTruthy();
    });
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
