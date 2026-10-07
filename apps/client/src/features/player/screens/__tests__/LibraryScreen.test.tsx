import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLibraryLogic } from "../../hooks/useLibraryLogic";
import { LibraryScreen } from "../LibraryScreen";

// Mock the Logic Hook
jest.mock("../../hooks/useLibraryLogic");

// Mock the auth store so we can drive the current user's role. The add-track
// affordance is ADMIN-only (shared, read-only catalog for everyone else).
const mockAuthState: { role: string | null; isGuest: boolean } = {
  role: null,
  isGuest: false,
};
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: () => mockAuthState,
}));

// Inline ThemeContext Mock for stability
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Navigation
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
}));

// Mock UI Components
jest.mock("../../components/AddTrackModal", () => ({
  AddTrackModal: () => null,
}));
jest.mock("../../../track-corrections/components/TrackCorrectionModal", () => {
  const ReactMock = require("react");
  const { Text } = require("react-native");
  return {
    TrackCorrectionModal: ({
      visible,
      track,
    }: {
      visible: boolean;
      track: { id: string; title: string } | null;
    }) =>
      visible
        ? ReactMock.createElement(
            Text,
            { testID: "report-modal" },
            track?.title ?? "",
          )
        : null,
  };
});
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

jest.mock("../../../../components/FluidSegmentedTab", () => {
  const ReactMock = require("react");
  const { View, Text, TouchableOpacity } = require("react-native");
  return {
    FluidSegmentedTab: ({
      options,
      onChange,
    }: {
      options: Array<{ value: string; label: string }>;
      onChange: (v: string) => void;
    }) =>
      ReactMock.createElement(
        View,
        { testID: "segmented-tab" },
        options.map((o: { value: string; label: string }) =>
          ReactMock.createElement(
            TouchableOpacity,
            {
              key: o.value,
              onPress: () => onChange(o.value),
              testID: `tab-${o.value}`,
            },
            ReactMock.createElement(Text, {}, o.label),
          ),
        ),
      ),
  };
});

// Mock Icons — Proxy so any lucide icon resolves to a stub.
jest.mock("lucide-react-native", () => {
  const ReactMock = require("react");
  const { Text } = require("react-native");
  return new Proxy(
    {},
    {
      get: (_t, name) => () => ReactMock.createElement(Text, {}, String(name)),
    },
  );
});

// Mock SafeAreaView
jest.mock("react-native-safe-area-context", () => {
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

describe("LibraryScreen", () => {
  const defaultState = {
    isModalVisible: false,
    selectedSection: null,
    activeTab: "default",
    addButtonOrigin: null,
    sections: [],
    allTracks: [],
    searchQuery: "",
    currentTrack: null,
    isPlaying: false,
    isLiked: jest.fn(() => false),
    displayData: [],
  };

  const defaultActions = {
    setModalVisible: jest.fn(),
    setSelectedSection: jest.fn(),
    setActiveTab: jest.fn(),
    setAddButtonOrigin: jest.fn(),
    setSearchQuery: jest.fn(),
    handleTrackPress: jest.fn(),
    handleSectionPress: jest.fn(),
    handleBackPress: jest.fn(),
  };

  const mockTheme = {
    theme: {
      background: "#ffffff",
      surface: "#f2f2f2",
      text: "#111111",
      textSecondary: "#666666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      colors: { primary: "#3b82f6", background: "#ffffff" },
      spacing: { s: 4, m: 8, l: 16, xl: 24, xs: 2, xxl: 32 },
    },
    isDark: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.role = null;
    mockAuthState.isGuest = false;
    mockIngestionEnabled = true;
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: defaultState,
      actions: defaultActions,
    });
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
  });

  const createTestProps = () => createMockScreenProps("Library", undefined);

  it("renders correctly", async () => {
    const { getByText } = await render(
      <LibraryScreen {...createTestProps()} />,
    );
    expect(getByText("Bibliothèque")).toBeTruthy();
  });

  it("renders track list", async () => {
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
      },
      actions: defaultActions,
    });

    const { getByText } = await render(
      <LibraryScreen {...createTestProps()} />,
    );
    expect(getByText("Track 1")).toBeTruthy();
    expect(getByText("Artist 1")).toBeTruthy();
  });

  it("calls handleTrackPress when track is pressed", async () => {
    const handleTrackPress = jest.fn();
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
      },
      actions: { ...defaultActions, handleTrackPress },
    });

    const { getByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("library-track-t1"));
    expect(handleTrackPress).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1" }),
    );
  });

  it("shows empty state", async () => {
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: { ...defaultState, displayData: [] },
      actions: defaultActions,
    });

    const { getByText } = await render(
      <LibraryScreen {...createTestProps()} />,
    );
    expect(getByText("Votre bibliothèque est vide.")).toBeTruthy();
  });

  it("opens the report modal on long-press for a non-admin", async () => {
    mockAuthState.role = "LICENSEE";
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
      },
      actions: defaultActions,
    });

    const { getByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    await fireEvent(getByTestId("library-track-t1"), "onLongPress");

    expect(getByTestId("report-modal")).toBeTruthy();
    expect(getByTestId("report-modal").props.children).toBe("Track 1");
  });

  it("does not open the correction modal on long-press for a guest", async () => {
    mockAuthState.role = "GUEST";
    mockAuthState.isGuest = true;
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
      },
      actions: defaultActions,
    });

    const { getByTestId, queryByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    await fireEvent(getByTestId("library-track-t1"), "onLongPress");

    expect(queryByTestId("report-modal")).toBeNull();
  });

  it("does not open the report modal on long-press for an admin", async () => {
    mockAuthState.role = "ADMIN";
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
      },
      actions: defaultActions,
    });

    const { getByTestId, queryByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    await fireEvent(getByTestId("library-track-t1"), "onLongPress");

    expect(queryByTestId("report-modal")).toBeNull();
  });

  it("calls handleSectionPress in grid view", async () => {
    const handleSectionPress = jest.fn();
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        activeTab: "style",
        sections: [{ title: "Latin", data: [] }],
      },
      actions: { ...defaultActions, handleSectionPress },
    });

    const { getByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    await fireEvent.press(getByTestId("library-section-Latin"));
    expect(handleSectionPress).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Latin" }),
    );
  });
});
