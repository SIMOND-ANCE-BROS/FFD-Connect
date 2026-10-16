import { RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import type {
  MockDateTimePickerProps,
  MockDraggableFlatListProps,
  MockFluidSegmentedTabProps,
  MockGooglePlacesAutocompleteProps,
  MockIconProps,
  MockRouteProp,
  MockScaleDecoratorProps,
} from "../../../../__tests__/mocks/types";
import { RootStackParamList } from "../../../../navigation/types";
import { CheckinService } from "../../../license/services/CheckinService";
import { fetchCompetitionProgram } from "../../services/competitionProgramApi";
import { ClubCompetitionFormScreen } from "../ClubCompetitionFormScreen";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Mock @env
jest.mock("@env", () => ({ GOOGLE_API_KEY: "test" }));

// Programme API (#442): an existing competition loads its events/schedule.
jest.mock("../../services/competitionProgramApi", () => ({
  CompetitionProgramError: class CompetitionProgramError extends Error {},
  fetchCompetitionProgram: jest.fn(),
  saveCompetitionProgram: jest.fn(),
}));

const emptyProgram = {
  competitionId: "comp-123",
  syncedFromFfd: false,
  eventsSource: null,
  programEditedAt: null,
  events: [],
  schedule: [],
};

// Mock ThemeContext
// Mock ThemeContext
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      colors: { primary: "blue", background: "white" },
    },
    isDark: false,
  }),
}));

// Mock FluidSegmentedTab
jest.mock("../../../../components/FluidSegmentedTab", () => {
  const { View, Text, TouchableOpacity } = require("react-native");
  return {
    FluidSegmentedTab: ({
      options,
      onChange,
      activeValue: _activeValue,
    }: MockFluidSegmentedTabProps) => (
      <View testID="segmented-tab">
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
      </View>
    ),
  };
});

// Mock external libs
jest.mock("react-native-google-places-autocomplete", () => {
  const { View } = require("react-native");
  return {
    GooglePlacesAutocomplete: (_props: MockGooglePlacesAutocompleteProps) => (
      <View testID="google-places-autocomplete" />
    ),
  };
});

jest.mock("../../../license/services/CheckinService", () => ({
  CheckinService: {
    generateVolunteerToken: jest.fn(),
  },
}));

jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return (_props: MockDateTimePickerProps) => <View testID="datetimepicker" />;
});

jest.mock("lucide-react-native", () => {
  const { View } = require("react-native");
  const MockIcon = (props: MockIconProps) => <View {...props} />;
  return {
    AlignLeft: MockIcon,
    Calendar: MockIcon,
    Clock: MockIcon,
    Copy: MockIcon,
    Edit2: MockIcon,
    GripVertical: MockIcon,
    Info: MockIcon,
    Lock: MockIcon,
    Plus: MockIcon,
    QrCode: MockIcon,
    Trash2: MockIcon,
    Trophy: MockIcon,
    Users: MockIcon,
    X: MockIcon,
  };
});

jest.mock("../../components/LayoutCanvas", () => ({
  LayoutCanvas: () => {
    const { View } = require("react-native");
    return <View testID="layout-canvas" />;
  },
}));

jest.mock("react-native-draggable-flatlist", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: <T extends { id: string }>(
      props: MockDraggableFlatListProps<T>,
    ) => {
      return (
        <View testID="draggable-flatlist">
          {props.data.map((item) => (
            <View key={item.id}>
              {props.renderItem({ item, drag: jest.fn(), isActive: false })}
            </View>
          ))}
          {props.ListFooterComponent}
        </View>
      );
    },
    ScaleDecorator: ({ children }: MockScaleDecoratorProps) => <>{children}</>,
  };
});

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal", "ScrollView", "Alert");

describe("ClubCompetitionFormScreen", () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };

  const originalConsoleError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      if (/Warning.*update a component/.test(String(args[0]))) return;
      originalConsoleError(...args);
    };
  });
  afterAll(() => {
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (fetchCompetitionProgram as jest.Mock).mockResolvedValue(emptyProgram);
  });

  it("validates required fields on save", async () => {
    const { getByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={{ params: {} } as MockRouteProp<"ClubCompetitionEditor">}
      />,
    );

    await fireEvent.press(getByText("Enregistrer"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      'Veuillez remplir les champs obligatoires dans "Général"',
    );
  });

  it("switches tabs and displays different content", async () => {
    const { getByText, queryByText, getByTestId, queryByTestId } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          { params: {} } as unknown as RouteProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
      />,
    );

    // Initial tab is Général, offering only the API statuses (#417)
    expect(getByText("Informations Générales")).toBeTruthy();
    expect(getByText("À venir")).toBeTruthy();
    expect(queryByText("Brouillon")).toBeNull();

    // Switch to Épreuves (Tab value EVENTS)
    await fireEvent.press(getByTestId("tab-EVENTS"));
    expect(getByText("Ajouter une épreuve")).toBeTruthy();
    expect(queryByText("Informations Générales")).toBeNull();
    // Saved with the competition since #442: no « preview » banner.
    expect(queryByTestId("competition-events-notice")).toBeNull();

    // Switch to Planning (Tab value TIMING)
    await fireEvent.press(getByTestId("tab-TIMING"));
    expect(getByText("Ajouter un créneau")).toBeTruthy();
    expect(queryByTestId("competition-timing-notice")).toBeNull();
  });

  it("loads an existing competition's programme into the tabs (#442)", async () => {
    (fetchCompetitionProgram as jest.Mock).mockResolvedValue({
      ...emptyProgram,
      syncedFromFfd: true,
      events: [
        {
          id: "ev-1",
          eventKind: "CLASSIFICATRICE",
          eventType: "COUPLE",
          category: "Latin",
          ageGroup: "Youth",
          ageGroups: [],
          level: "Avancé",
          openLevels: [],
          locked: true,
        },
      ],
      schedule: [
        {
          id: "slot-1",
          startTime: "09:30",
          durationMinutes: 20,
          type: "ROUND",
          title: "Latines Youth — finale",
          eventId: null,
        },
      ],
    });

    const { getByTestId, findByText, getByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: { competition: { id: "comp-123", title: "Open" } },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    expect(fetchCompetitionProgram).toHaveBeenCalledWith("comp-123");
    await fireEvent.press(getByTestId("tab-EVENTS"));
    expect(await findByText("Youth · Avancé")).toBeTruthy();
    // Imported from the FFD: the club is told the sync won't replace them.
    expect(getByTestId("competition-events-notice")).toBeTruthy();
    expect(getByText(/importée de la FFD/)).toBeTruthy();

    // An event with registrations can't be removed.
    await fireEvent.press(getByTestId("event-delete-ev-1"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Épreuve verrouillée",
      expect.stringContaining("ne peut pas être retirée"),
    );
    expect(getByText("Youth · Avancé")).toBeTruthy();

    await fireEvent.press(getByTestId("tab-TIMING"));
    expect(getByText("Latines Youth — finale")).toBeTruthy();
  });

  it("tells the club when the programme could not be loaded (#442)", async () => {
    (fetchCompetitionProgram as jest.Mock).mockRejectedValue(new Error("500"));

    const { getByTestId, findByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: { competition: { id: "comp-123" } },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    await fireEvent.press(getByTestId("tab-TIMING"));
    expect(await findByText(/n'ont pas pu être chargés/)).toBeTruthy();
  });

  it("a11y (#386): text inputs are announced with French labels", async () => {
    const { getByLabelText, queryByLabelText, getByTestId, getByText } =
      await render(
        <ClubCompetitionFormScreen
          navigation={
            navigation as unknown as NativeStackNavigationProp<
              RootStackParamList,
              "ClubCompetitionEditor"
            >
          }
          route={{ params: {} } as MockRouteProp<"ClubCompetitionEditor">}
        />,
      );

    expect(getByLabelText("Nom de l'événement").props.testID).toBe(
      "competition-editor-title-input",
    );

    await fireEvent.press(getByTestId("tab-TIMING"));
    await fireEvent.press(getByText("Ajouter un créneau"));

    expect(getByLabelText("Titre du créneau").props.testID).toBe(
      "timing-title-input",
    );
    expect(getByLabelText("Durée du créneau en minutes")).toBeTruthy();
    expect(queryByLabelText("Text input field")).toBeNull();
  });

  it("adds an event via modal", async () => {
    const { getByText, getByTestId, getAllByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          { params: {} } as unknown as RouteProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
      />,
    );

    await fireEvent.press(getByTestId("tab-EVENTS"));
    await fireEvent.press(getByText("Ajouter une épreuve"));

    // Modal is shown
    expect(getByText("Catégorie")).toBeTruthy();

    // Select Standard
    await fireEvent.press(getByTestId("tab-Standard"));

    // Select Age (Standard/Couple is default)
    // We assume Junior II is available in list
    await fireEvent.press(getAllByText("Junior II")[0]);

    // Add event
    await fireEvent.press(getByText("Ajouter"));

    // Event should be added to the list - at least 1 occurrence of Standards (in event list)
    expect(getAllByText("Standards").length).toBeGreaterThanOrEqual(1);
    // The event is added with age "Junior II"
    expect(
      getAllByText(/Junior II/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("manages timing items", async () => {
    const initialCompetition = {
      schedule: [
        {
          id: "1",
          type: "COMPETITION",
          title: "Latine - Adulte - 1/4 Finale",
          startTime: "10:00",
          duration: 15,
        },
      ],
    };

    const { getByText, getByTestId, queryByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: { competition: initialCompetition },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    await fireEvent.press(getByTestId("tab-TIMING"));

    // Initial timing exists
    expect(getByText("Latine - Adulte - 1/4 Finale")).toBeTruthy();

    // Edit timing (id '1') — modal opens synchronously via fireEvent (act)
    await fireEvent.press(getByTestId("timing-edit-1"));
    await fireEvent.changeText(getByTestId("timing-title-input"), "New Title");
    await fireEvent.press(getByText("Sauvegarder"));

    expect(getByText("New Title")).toBeTruthy();
    expect(queryByText("Latine - Adulte - 1/4 Finale")).toBeNull();
  });

  it("removes event and timing items", async () => {
    const initialCompetition = {
      events: [
        {
          id: "e1",
          type: "Solo",
          category: "Latine",
          ageGroup: "Junior I",
        },
      ],
      schedule: [
        {
          id: "t1",
          type: "COMPETITION",
          title: "Timing to delete",
          startTime: "10:00",
          duration: 15,
        },
      ],
    };

    const { getByText, getByTestId, queryByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: { competition: initialCompetition },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    // Remove Event
    await fireEvent.press(getByTestId("tab-EVENTS"));
    expect(getByText("Junior I")).toBeTruthy();
    await fireEvent.press(getByTestId("event-delete-e1"));
    // Event should be gone (might need re-render or state update check, but standard testing-library handles it)
    expect(queryByText("Junior I")).toBeNull();

    // Remove Timing
    await fireEvent.press(getByTestId("tab-TIMING"));
    expect(getByText("Timing to delete")).toBeTruthy();
    await fireEvent.press(getByTestId("timing-delete-t1"));
    expect(queryByText("Timing to delete")).toBeNull();
  });

  it("manages volunteer access in Organisation tab", async () => {
    const initialCompetition = { id: "comp-123" };
    const mockToken = { accessUrl: "https://test.com/v/token-123" };
    (CheckinService.generateVolunteerToken as jest.Mock).mockResolvedValue(
      mockToken,
    );

    const { getByText, getByTestId, findByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: { competition: initialCompetition },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    // Go to Organisation tab
    await fireEvent.press(getByTestId("tab-ORGANISATION"));
    expect(getByText("Accès Bénévoles")).toBeTruthy();

    // Generate token
    await fireEvent.press(getByText("Générer un QR d'accès"));

    // Wait for modal to appear (QR code value check)
    expect(CheckinService.generateVolunteerToken).toHaveBeenCalledWith(
      "comp-123",
    );
    expect(await findByText("Accès Bénévole")).toBeTruthy();
    expect(getByText("Copier le lien")).toBeTruthy();
  });

  describe("results import entry (#690)", () => {
    const renderWith = (params: Record<string, unknown>) =>
      render(
        <ClubCompetitionFormScreen
          navigation={
            navigation as unknown as NativeStackNavigationProp<
              RootStackParamList,
              "ClubCompetitionEditor"
            >
          }
          route={
            { params } as unknown as RouteProp<
              RootStackParamList,
              "ClubCompetitionEditor"
            >
          }
        />,
      );

    it("opens the import for a saved competition of the club", async () => {
      const { getByTestId, getByRole } = await renderWith({
        competition: { id: "comp-123", title: "Open de Lyon" },
      });

      await fireEvent.press(getByTestId("tab-ORGANISATION"));
      await fireEvent.press(
        getByRole("button", { name: "Importer les résultats" }),
      );

      expect(navigation.navigate).toHaveBeenCalledWith("ClubResultsImport", {
        competitionId: "comp-123",
        competitionTitle: "Open de Lyon",
      });
    });

    it("is not offered for a competition not created yet", async () => {
      const { getByTestId, queryByTestId } = await renderWith({});

      await fireEvent.press(getByTestId("tab-ORGANISATION"));

      expect(queryByTestId("competition-results-import-button")).toBeNull();
    });

    it("is not offered for an event (no épreuves, no results)", async () => {
      const { getByTestId, queryByTestId } = await renderWith({
        competition: { id: "comp-123", type: "EVENT" },
      });

      await fireEvent.press(getByTestId("tab-ORGANISATION"));

      expect(queryByTestId("competition-results-import-button")).toBeNull();
    });
  });

  it("toggles « QR tournant obligatoire » in the Organisation tab (#668)", async () => {
    const { getByTestId, getByLabelText, getByText } = await render(
      <ClubCompetitionFormScreen
        navigation={
          navigation as unknown as NativeStackNavigationProp<
            RootStackParamList,
            "ClubCompetitionEditor"
          >
        }
        route={
          {
            params: {
              competition: { id: "comp-123", requireRotatingQr: true },
            },
          } as unknown as RouteProp<RootStackParamList, "ClubCompetitionEditor">
        }
      />,
    );

    await fireEvent.press(getByTestId("tab-ORGANISATION"));
    const toggle = getByLabelText("QR tournant obligatoire");
    // Loaded from the competition.
    expect(toggle.props.value).toBe(true);
    // The organiser is told what gets refused.
    expect(
      getByText(/pass Apple Wallet et les anciennes versions/),
    ).toBeTruthy();

    await fireEvent(toggle, "valueChange", false);
    expect(getByLabelText("QR tournant obligatoire").props.value).toBe(false);
  });

  describe("screen reader (#22)", () => {
    const renderWith = (competition: Record<string, unknown>) =>
      render(
        <ClubCompetitionFormScreen
          navigation={
            navigation as unknown as NativeStackNavigationProp<
              RootStackParamList,
              "ClubCompetitionEditor"
            >
          }
          route={
            {
              params: { competition },
            } as unknown as RouteProp<
              RootStackParamList,
              "ClubCompetitionEditor"
            >
          }
        />,
      );

    it("names the close button and exposes the title as a heading", async () => {
      const { getByRole } = await renderWith({});
      await fireEvent.press(getByRole("button", { name: "Fermer l'éditeur" }));
      expect(navigation.goBack).toHaveBeenCalled();
      expect(
        getByRole("header", { name: "Nouvelle Compétition" }),
      ).toBeTruthy();
    });

    it("names each event's delete button with the event it removes", async () => {
      const { getByTestId, getByRole } = await renderWith({
        events: [
          { id: "e1", type: "Solo", category: "Latine", ageGroup: "Junior I" },
        ],
      });
      await fireEvent.press(getByTestId("tab-EVENTS"));
      const del = getByRole("button", { name: /^Retirer l'épreuve : Solo, / });
      expect(del.props.testID).toBe("event-delete-e1");
      expect(getByTestId("event-summary-e1").props.accessibilityLabel).toMatch(
        /Junior I$/,
      );
    });

    it("reads a slot as one sentence and moves it with accessibility actions", async () => {
      const {
        getByTestId,
        getByLabelText,
        getAllByTestId,
        getByRole,
        getByText,
        queryByText,
      } = await renderWith({
        schedule: [
          {
            id: "t1",
            type: "ROUND",
            title: "Finale",
            startTime: "10:00",
            duration: 15,
          },
          {
            id: "t2",
            type: "BREAK",
            title: "Déjeuner",
            startTime: "10:15",
            duration: 45,
          },
        ],
      });
      await fireEvent.press(getByTestId("tab-TIMING"));

      const first = getByLabelText("10:00, 15 minutes, Finale, Tour");
      // The visible type is French too, never the raw « ROUND » enum.
      expect(getByText("Tour")).toBeTruthy();
      expect(getByText("Pause")).toBeTruthy();
      expect(queryByText("ROUND")).toBeNull();
      expect(
        (first.props.accessibilityActions as { name: string }[]).map(
          (a) => a.name,
        ),
      ).toEqual(["moveDown"]);
      expect(
        getByRole("button", { name: "Modifier le créneau : Déjeuner" }).props
          .testID,
      ).toBe("timing-edit-t2");
      expect(
        getByRole("button", { name: "Supprimer le créneau : Finale" }).props
          .testID,
      ).toBe("timing-delete-t1");

      await fireEvent(first, "accessibilityAction", {
        nativeEvent: { actionName: "moveDown" },
      });
      expect(
        getAllByTestId(/^timing-summary-/).map((n) => n.props.testID as string),
      ).toEqual(["timing-summary-t2", "timing-summary-t1"]);
    });
  });
});
