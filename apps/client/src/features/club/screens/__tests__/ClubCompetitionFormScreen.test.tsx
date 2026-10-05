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
import { ClubCompetitionFormScreen } from "../ClubCompetitionFormScreen";

// Mock @env
jest.mock("@env", () => ({ GOOGLE_API_KEY: "test" }));

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
    Plus: MockIcon,
    Trash2: MockIcon,
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
    const { getByText, queryByText, getByTestId } = await render(
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

    // Initial tab is Général
    expect(getByText("Informations Générales")).toBeTruthy();

    // Switch to Épreuves (Tab value EVENTS)
    await fireEvent.press(getByTestId("tab-EVENTS"));
    expect(getByText("Ajouter une épreuve")).toBeTruthy();
    expect(queryByText("Informations Générales")).toBeNull();

    // Switch to Planning (Tab value TIMING)
    await fireEvent.press(getByTestId("tab-TIMING"));
    expect(getByText("Ajouter un créneau")).toBeTruthy();
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

    // Event should be added to the list - at least 1 occurrence of Standard (in event list)
    expect(getAllByText("Standard").length).toBeGreaterThanOrEqual(1);
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
});
