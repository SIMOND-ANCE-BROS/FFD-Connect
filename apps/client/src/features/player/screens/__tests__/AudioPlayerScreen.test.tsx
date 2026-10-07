import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { useAuthStore } from "../../../../stores/auth.store";
import {
  fireEvent,
  render,
  createMockScreenProps,
} from "../../../../utils/testUtils";
import { ContextRepeatMode } from "../../context";
import { useAudioPlayerLogic } from "../../hooks/useAudioPlayerLogic";
import { AudioPlayerScreen } from "../AudioPlayerScreen";

// Mock Logic Hook
jest.mock("../../hooks/useAudioPlayerLogic");

// Inline ThemeContext Mock for stability
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Navigation
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
}));

describe("AudioPlayerScreen", () => {
  const mockActions = {
    togglePlayback: jest.fn().mockResolvedValue(undefined),
    handleNext: jest.fn().mockResolvedValue(undefined),
    handlePrev: jest.fn().mockResolvedValue(undefined),
    changeBpm: jest.fn().mockResolvedValue(undefined),
    resetBpm: jest.fn().mockResolvedValue(undefined),
    setIsBpmVisible: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    toggleLike: jest.fn().mockResolvedValue(undefined),
    toggleRepeat: jest.fn().mockResolvedValue(undefined),
    toggleShuffle: jest.fn().mockResolvedValue(undefined),
    openQueue: jest.fn(),
    closeQueue: jest.fn(),
    playQueueTrack: jest.fn().mockResolvedValue(undefined),
    removeQueueTrack: jest.fn().mockResolvedValue(undefined),
  };

  const baseState = {
    tracks: [],
    currentTrack: {
      id: "track-1",
      title: "Track 1",
      artist: "Artist 1",
      baseBpm: 120,
      playlist: "Lecteur",
    },
    isPlaying: false,
    isPlayerReady: true,
    bpm: 120,
    baseMpm: 120,
    minMpm: 60,
    maxMpm: 180,
    bpmDiff: 0,
    isBpmVisible: false,
    progress: { position: 0, duration: 200 },
    isLoading: false,
    errorMessage: null,
    isLiked: false,
    repeatMode: ContextRepeatMode.Off,
    isShuffle: false,
    isQueueVisible: false,
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
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
    (useAudioPlayerLogic as jest.Mock).mockReturnValue({
      state: baseState,
      actions: mockActions,
    });
  });

  const createTestProps = () => createMockScreenProps("AudioPlayer", undefined);

  describe("Happy Path", () => {
    it("calls main player actions on button press", async () => {
      const props = createTestProps();
      const { getByTestId } = await render(<AudioPlayerScreen {...props} />);

      await fireEvent.press(getByTestId("audio-player-back-button"));
      await fireEvent.press(getByTestId("audio-player-like-button"));
      await fireEvent.press(getByTestId("audio-player-bpm-toggle-button"));
      await fireEvent.press(getByTestId("audio-player-shuffle-button"));
      await fireEvent.press(getByTestId("audio-player-prev-button"));
      await fireEvent.press(getByTestId("audio-player-play-button"));
      await fireEvent.press(getByTestId("audio-player-next-button"));
      await fireEvent.press(getByTestId("audio-player-repeat-button"));
      await fireEvent.press(getByTestId("audio-player-queue-button"));

      expect(props.navigation.goBack).toHaveBeenCalled();
      expect(mockActions.toggleLike).toHaveBeenCalled();
      expect(mockActions.setIsBpmVisible).toHaveBeenCalledWith(true);
      expect(mockActions.toggleShuffle).toHaveBeenCalled();
      expect(mockActions.handlePrev).toHaveBeenCalled();
      expect(mockActions.togglePlayback).toHaveBeenCalled();
      expect(mockActions.handleNext).toHaveBeenCalled();
      expect(mockActions.toggleRepeat).toHaveBeenCalled();
      expect(mockActions.openQueue).toHaveBeenCalled();
    });

    it("controls BPM shortcuts when panel is visible", async () => {
      (useAudioPlayerLogic as jest.Mock).mockReturnValue({
        state: { ...baseState, isBpmVisible: true },
        actions: mockActions,
      });

      const props = createTestProps();
      const { getByTestId } = await render(<AudioPlayerScreen {...props} />);

      await fireEvent.press(getByTestId("audio-player-bpm-min-button"));
      await fireEvent.press(getByTestId("audio-player-bpm-reset-button"));
      await fireEvent.press(getByTestId("audio-player-bpm-max-button"));

      expect(mockActions.changeBpm).toHaveBeenCalledWith(baseState.minMpm);
      expect(mockActions.resetBpm).toHaveBeenCalled();
      expect(mockActions.changeBpm).toHaveBeenCalledWith(baseState.maxMpm);
    });
  });

  describe("Error Handling", () => {
    it("retries playback when error is shown", async () => {
      (useAudioPlayerLogic as jest.Mock).mockReturnValue({
        state: { ...baseState, errorMessage: "Erreur" },
        actions: mockActions,
      });

      const props = createTestProps();
      const { getByTestId } = await render(<AudioPlayerScreen {...props} />);

      await fireEvent.press(getByTestId("audio-player-retry-button"));

      expect(mockActions.togglePlayback).toHaveBeenCalled();
    });
  });

  describe("Propositions de correction", () => {
    const renderWithQuery = (ui: React.ReactElement) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          {ui}
        </QueryClientProvider>,
      );

    const withTrack = (style?: string) =>
      (useAudioPlayerLogic as jest.Mock).mockReturnValue({
        state: {
          ...baseState,
          currentTrack: { ...baseState.currentTrack, style },
        },
        actions: mockActions,
      });

    afterEach(() => {
      useAuthStore.setState({ role: null, isGuest: false });
    });

    it("un licencié voit « Signaler / proposer une correction » et ouvre le formulaire pré-rempli", async () => {
      useAuthStore.setState({ role: "LICENSEE", isGuest: false });
      withTrack("Rumba");
      const { getByTestId, queryByTestId, getByText } = await renderWithQuery(
        <AudioPlayerScreen {...createTestProps()} />,
      );

      expect(queryByTestId("paso-propose-clashes-button")).toBeNull();
      await fireEvent.press(getByTestId("player-propose-correction-button"));
      expect(getByText("Proposer une correction")).toBeTruthy();
      await fireEvent.press(getByTestId("correction-reason-MPM"));
      expect(getByTestId("correction-mpm-input").props.value).toBe("120");
    });

    it("un invité ne voit aucune action de correction", async () => {
      useAuthStore.setState({ role: "GUEST", isGuest: true });
      withTrack("Paso Doble");
      const { queryByTestId } = await renderWithQuery(
        <AudioPlayerScreen {...createTestProps()} />,
      );
      expect(queryByTestId("player-propose-correction-button")).toBeNull();
      expect(queryByTestId("paso-propose-clashes-button")).toBeNull();
      expect(queryByTestId("paso-edit-clashes-button")).toBeNull();
    });

    it("sur un paso, un licencié propose les clashs (éditeur en mode proposition)", async () => {
      useAuthStore.setState({ role: "LICENSEE", isGuest: false });
      withTrack("Paso Doble");
      const { getByTestId, queryByTestId, getByText } = await renderWithQuery(
        <AudioPlayerScreen {...createTestProps()} />,
      );

      expect(queryByTestId("paso-edit-clashes-button")).toBeNull();
      await fireEvent.press(getByTestId("paso-propose-clashes-button"));
      expect(getByText("Proposer les appels")).toBeTruthy();
      expect(getByTestId("paso-propose")).toBeTruthy();
    });

    it("depuis le formulaire, « Clashs paso doble » ouvre l'éditeur sur un paso", async () => {
      useAuthStore.setState({ role: "LICENSEE", isGuest: false });
      withTrack("Paso Doble");
      const { getByTestId, getByText } = await renderWithQuery(
        <AudioPlayerScreen {...createTestProps()} />,
      );

      await fireEvent.press(getByTestId("player-propose-correction-button"));
      await fireEvent.press(getByTestId("correction-reason-PASO_CLASH"));
      await fireEvent.press(getByTestId("correction-open-clash-editor"));
      expect(getByText("Proposer les appels")).toBeTruthy();
    });

    it("un admin garde « Éditer les appels » et a aussi le raccourci de correction", async () => {
      useAuthStore.setState({ role: "ADMIN", isGuest: false });
      withTrack("Paso Doble");
      const { getByTestId, queryByTestId, getByText } = await renderWithQuery(
        <AudioPlayerScreen {...createTestProps()} />,
      );

      expect(queryByTestId("paso-propose-clashes-button")).toBeNull();
      expect(getByTestId("player-propose-correction-button")).toBeTruthy();
      await fireEvent.press(getByTestId("paso-edit-clashes-button"));
      expect(getByText("Appels du paso doble")).toBeTruthy();
      expect(getByTestId("paso-save")).toBeTruthy();
    });
  });
});
