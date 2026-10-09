import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useLibraryLogic } from "../../hooks/useLibraryLogic";
import { LibraryScreen } from "../LibraryScreen";

// Mock the Logic Hook
jest.mock("../../hooks/useLibraryLogic");

let mockIsOnline = true;
jest.mock("../../../../hooks/useIsOnline", () => ({
  useIsOnline: () => mockIsOnline,
}));

const mockGetTrack = jest.fn();
jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    getTrack: (...args: unknown[]) => mockGetTrack(...args) as unknown,
  },
}));

// Mock the auth store so we can drive the current user's role. The add-track
// affordance is ADMIN-only (shared, read-only catalog for everyone else).
const mockAuthState: {
  role: string | null;
  roles: string[];
  isGuest: boolean;
  hasRole: (r: string) => boolean;
} = {
  role: null,
  roles: [],
  isGuest: false,
  hasRole: (r) => mockAuthState.roles.includes(r),
};
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (selector?: (s: typeof mockAuthState) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
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
    handlePlayNext: jest.fn().mockResolvedValue("queued"),
    handleAddToQueue: jest.fn().mockResolvedValue("queued"),
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
    mockIsOnline = true;
    mockAuthState.role = null;
    mockAuthState.roles = [];
    mockAuthState.isGuest = false;
    mockIsOnline = true;
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

  // Beta feedback: on first load the empty state and the "Chargement…"
  // footer were shown together. One centered loader instead.
  it("shows a single loader, no empty state, during the first load", async () => {
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [],
        isInitialLoading: true,
        isLoadingMore: true,
        hasMore: true,
      },
      actions: { ...defaultActions, loadMore: jest.fn() },
    });

    const { getAllByTestId, queryByText, queryByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    expect(getAllByTestId("library-loading")).toHaveLength(1);
    expect(queryByText("Votre bibliothèque est vide.")).toBeNull();
    expect(queryByText("Chargement…")).toBeNull();
    expect(queryByTestId("library-loading-more")).toBeNull();
  });

  it("shows the next-page spinner under loaded tracks", async () => {
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: {
        ...defaultState,
        displayData: [
          { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
        ],
        isInitialLoading: false,
        isLoadingMore: true,
        hasMore: true,
      },
      actions: { ...defaultActions, loadMore: jest.fn() },
    });

    const { getByTestId, queryByTestId } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    expect(getByTestId("library-loading-more")).toBeTruthy();
    expect(queryByTestId("library-loading")).toBeNull();
  });

  it("says the library is unavailable offline instead of empty", async () => {
    mockIsOnline = false;
    (useLibraryLogic as jest.Mock).mockReturnValue({
      state: { ...defaultState, displayData: [], isInitialLoading: false },
      actions: defaultActions,
    });

    const { getByText, queryByText } = await render(
      <LibraryScreen {...createTestProps()} />,
    );

    expect(getByText("Hors ligne")).toBeTruthy();
    expect(queryByText("Votre bibliothèque est vide.")).toBeNull();
  });

  describe("long-press track sheet", () => {
    const withTrack = (actions: Record<string, unknown> = {}) =>
      (useLibraryLogic as jest.Mock).mockReturnValue({
        state: {
          ...defaultState,
          displayData: [
            { id: "t1", title: "Track 1", artist: "Artist 1", baseBpm: 120 },
          ],
        },
        actions: { ...defaultActions, ...actions },
      });

    // The extra action runs once the sheet has slid out (iOS: onDismiss, with
    // a timer fallback — the one exercised here).
    const pressExtraAction = async (action: "report" | "edit") => {
      await fireEvent.press(screen.getByTestId(`track-action-${action}`));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
      });
    };

    it("opens the sheet with the queue actions", async () => {
      withTrack();
      const { getByTestId, getByText } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");

      expect(getByTestId("track-actions-sheet")).toBeTruthy();
      expect(getByText("Lire ensuite")).toBeTruthy();
      expect(getByText("Ajouter à la file")).toBeTruthy();
    });

    it("« Lire ensuite » queues the track and confirms it", async () => {
      const handlePlayNext = jest.fn().mockResolvedValue("queued");
      withTrack({ handlePlayNext });
      const { getByTestId, findByText } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      await fireEvent.press(getByTestId("track-action-play-next"));

      expect(handlePlayNext).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t1" }),
      );
      expect(await findByText("« Track 1 » sera lu ensuite")).toBeTruthy();
    });

    it("« Ajouter à la file » appends the track and confirms it", async () => {
      const handleAddToQueue = jest.fn().mockResolvedValue("started");
      withTrack({ handleAddToQueue });
      const { getByTestId, findByText } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      await fireEvent.press(getByTestId("track-action-add-to-queue"));

      expect(handleAddToQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t1" }),
      );
      expect(await findByText("Lecture de « Track 1 »")).toBeTruthy();
    });

    it("shows a failure notice when the queue action throws", async () => {
      const handleAddToQueue = jest.fn().mockRejectedValue(new Error("boom"));
      withTrack({ handleAddToQueue });
      const { getByTestId, findByText } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      await fireEvent.press(getByTestId("track-action-add-to-queue"));

      expect(await findByText("Impossible de lire « Track 1 »")).toBeTruthy();
    });

    it("blocks queueing a non-downloaded track offline", async () => {
      mockIsOnline = false;
      const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const handlePlayNext = jest.fn();
      withTrack({ handlePlayNext });
      const { getByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      await fireEvent.press(getByTestId("track-action-play-next"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
      });

      expect(handlePlayNext).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        "Non disponible hors ligne",
        expect.any(String),
      );
      alertSpy.mockRestore();
    });

    it("opens the report modal from the sheet for a non-admin", async () => {
      mockAuthState.role = "LICENSEE";
      withTrack();
      const { getByTestId, queryByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      expect(queryByTestId("track-action-edit")).toBeNull();
      await pressExtraAction("report");

      expect(getByTestId("report-modal")).toBeTruthy();
      expect(getByTestId("report-modal").props.children).toBe("Track 1");
    });

    it("offers no correction action to a guest", async () => {
      mockAuthState.role = "GUEST";
      mockAuthState.isGuest = true;
      withTrack();
      const { getByTestId, queryByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");

      expect(getByTestId("track-action-play-next")).toBeTruthy();
      expect(queryByTestId("track-action-report")).toBeNull();
      expect(queryByTestId("track-action-edit")).toBeNull();
      expect(queryByTestId("report-modal")).toBeNull();
    });

    it("offers the edit action (not the report one) to an admin", async () => {
      mockAuthState.role = "ADMIN";
      mockAuthState.roles = ["ADMIN"];
      mockGetTrack.mockResolvedValue({
        id: "t1",
        title: "Track 1",
        artist: "Artist 1",
        bpm: 120,
        rawBpm: 120,
        style: "Rumba",
        filename: "t1.mp3",
      });
      const setModalVisible = jest.fn();
      withTrack({ setModalVisible });
      const { getByTestId, queryByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      expect(queryByTestId("track-action-report")).toBeNull();
      await pressExtraAction("edit");

      expect(mockGetTrack).toHaveBeenCalledWith("t1");
      expect(setModalVisible).toHaveBeenCalledWith(true);
      expect(queryByTestId("report-modal")).toBeNull();
    });

    it("keeps the admin edit action in another space when the account holds ADMIN", async () => {
      mockAuthState.role = "LICENSEE";
      mockAuthState.roles = ["ADMIN", "LICENSEE"];
      withTrack();
      const { getByTestId, queryByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");

      expect(getByTestId("track-action-edit")).toBeTruthy();
      expect(queryByTestId("track-action-report")).toBeNull();
    });

    it("opens the report modal in the LICENSEE space when the account is not admin", async () => {
      mockAuthState.role = "LICENSEE";
      mockAuthState.roles = ["LICENSEE", "CLUB"];
      withTrack();
      const { getByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      await pressExtraAction("report");

      expect(getByTestId("report-modal")).toBeTruthy();
    });

    it("closes the sheet from the backdrop", async () => {
      withTrack();
      const { getByTestId } = await render(
        <LibraryScreen {...createTestProps()} />,
      );

      await fireEvent(getByTestId("library-track-t1"), "onLongPress");
      expect(getByTestId("track-actions-sheet")).toBeTruthy();
      await fireEvent.press(getByTestId("track-actions-backdrop"));

      expect(screen.queryByTestId("track-actions-sheet")).toBeNull();
    });
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
