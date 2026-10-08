import { useNavigation } from "@react-navigation/native";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { usePerformanceEngine } from "../../hooks/usePerformanceEngine";
import { usePerformanceStore } from "../../../../stores/performance.store";
import { PerformancePlayerScreen } from "../PerformancePlayerScreen";

// Mock dependencies
jest.mock("../../hooks/usePerformanceEngine");
jest.mock("../../../../services/TtsService", () => ({
  default: { speak: jest.fn(), stop: jest.fn(), preload: jest.fn() },
}));
jest.mock("../../../../context/ThemeContext");
jest.mock("@react-navigation/native");

const mockUsePerformance = usePerformanceEngine as jest.MockedFunction<
  typeof usePerformanceEngine
>;
const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockUseNavigation = useNavigation as jest.MockedFunction<
  typeof useNavigation
>;

describe("PerformancePlayerScreen", () => {
  const mockNavigation = {
    goBack: jest.fn(),
  };

  const mockTheme = {
    background: "#FFFFFF",
    text: "#000000",
    textSecondary: "#666666",
    primary: "#007AFF",
    secondary: "#5856D6",
    accent: "#FF2D55",
    surface: "#F5F5F5",
    border: "#C7C7CC",
    inputBackground: "#EFEFF4",
    statusBarStyle: "dark-content" as const,
    dark: false,
    success: "#4CD964",
    warning: "#FFCC00",
    danger: "#FF3B30",
    colors: {} as never,
  };

  const mockPerformanceData = {
    status: "playing" as const,
    playlist: [
      {
        groupIndex: 1,
        totalGroups: 5,
        mixed: false,
        opensCategory: false,
        roundIndex: 1,
        totalRounds: 2,
        roundType: "Round" as const,
        category: "Latin" as const,
        dancesInRound: 2,
        danceIndex: 0,
        announcementText: "Samba !",
        style: "Samba",
        isPaso: false,
        announcementPath: "/path/to/audio.mp3",
        duration: 90,
        track: {
          id: "1",
          title: "Samba Track",
          artist: "Artist",
          url: "file://samba.mp3",
          baseBpm: 30,
        },
      },
      {
        groupIndex: 2,
        totalGroups: 5,
        mixed: false,
        opensCategory: false,
        roundIndex: 1,
        totalRounds: 2,
        roundType: "Round" as const,
        category: "Latin" as const,
        dancesInRound: 2,
        danceIndex: 1,
        announcementText: "Cha !",
        style: "Cha-Cha-Cha",
        isPaso: false,
        announcementPath: "/path/to/audio2.mp3",
        duration: 90,
        track: {
          id: "2",
          title: "Cha-Cha Track",
          artist: "Artist",
          url: "file://chacha.mp3",
          baseBpm: 30,
        },
      },
    ],
    currentDanceIndex: 0,
    timeRemaining: 90,
    activePhase: "dance" as const,
    loadingProgress: null,
    isAnnouncing: false,
    togglePlayPause: jest.fn(),
    nextStep: jest.fn(),
    previousStep: jest.fn(),
    stopPerformance: jest.fn(),
    config: {} as never,
    setConfig: jest.fn(),
    generatePlaylist: jest.fn(),
    startPerformance: jest.fn(),
    fadeNow: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNavigation.mockReturnValue(mockNavigation);
    mockUseTheme.mockReturnValue({
      theme: mockTheme,
      isDark: false,
      preference: "light",
      setPreference: jest.fn(),
      animationsEnabled: true,
      toggleAnimations: jest.fn(),
    });
    mockUsePerformance.mockReturnValue(mockPerformanceData);
  });

  describe("⏮ / ⏭ skip buttons", () => {
    it("skips forward and back while a dance plays", async () => {
      const { getByTestId } = await render(<PerformancePlayerScreen />);
      await fireEvent.press(getByTestId("performance-player-next-button"));
      expect(mockPerformanceData.nextStep).toHaveBeenCalled();
      await fireEvent.press(getByTestId("performance-player-previous-button"));
      expect(mockPerformanceData.previousStep).toHaveBeenCalled();
    });

    it("disables both while the announcement is spoken", async () => {
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        isAnnouncing: true,
      });
      const { getByTestId } = await render(<PerformancePlayerScreen />);
      await fireEvent.press(getByTestId("performance-player-next-button"));
      await fireEvent.press(getByTestId("performance-player-previous-button"));
      expect(mockPerformanceData.nextStep).not.toHaveBeenCalled();
      expect(mockPerformanceData.previousStep).not.toHaveBeenCalled();
    });

    it("allows only ⏭ during the initial get-ready break", async () => {
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        status: "break",
        activePhase: "break",
        currentDanceIndex: -1,
      });
      const { getByTestId } = await render(<PerformancePlayerScreen />);
      await fireEvent.press(getByTestId("performance-player-previous-button"));
      expect(mockPerformanceData.previousStep).not.toHaveBeenCalled();
      await fireEvent.press(getByTestId("performance-player-next-button"));
      expect(mockPerformanceData.nextStep).toHaveBeenCalled();
    });
  });

  describe("React Hooks Order (Regression Test)", () => {
    it("should call all hooks in the same order regardless of playlist state", async () => {
      // Arrange - Empty playlist
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        playlist: [],
        currentDanceIndex: 0,
      });

      // Act - First render with empty playlist
      const { rerender } = await render(<PerformancePlayerScreen />);

      // Assert - Should not crash (this is the key test)
      expect(mockUseTheme).toHaveBeenCalled();
      expect(mockUsePerformance).toHaveBeenCalled();
      expect(mockUseNavigation).toHaveBeenCalled();

      // Arrange - Now with playlist
      mockUsePerformance.mockReturnValue(mockPerformanceData);

      // Act - Rerender with playlist (should not crash)
      await rerender(<PerformancePlayerScreen />);

      // Assert - Should still work (no hooks order violation error)
      expect(true).toBe(true); // If we get here, hooks order is correct
    });

    it("should handle status changes without hooks order violation", async () => {
      // Arrange - Playing status
      const { rerender } = await render(<PerformancePlayerScreen />);

      // Act - Change to loading status
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        status: "loading",
      });
      await rerender(<PerformancePlayerScreen />);

      // Act - Change to finished status
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        status: "finished",
      });
      await rerender(<PerformancePlayerScreen />);

      // Assert - Should not crash (no hooks order violation)
      expect(true).toBe(true); // If we get here, hooks order is maintained
    });

    it("should render loading state without crashing", async () => {
      // Arrange
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        playlist: [],
        currentDanceIndex: 0,
        status: "idle",
      });

      // Act
      const { getAllByText } = await render(<PerformancePlayerScreen />);

      // Assert
      expect(getAllByText("PRÉPARATION").length).toBeGreaterThan(0);
    });

    it("does not crash during the initial break (currentDanceIndex = -1)", async () => {
      // Regression: playlist is non-empty but currentDanceIndex is -1 (initial
      // break). hasCurrentItem must be false so we don't read heatIndex of
      // playlist[-1] (undefined) → previously "Cannot read property 'heatIndex'".
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        currentDanceIndex: -1,
        activePhase: "break",
      });

      const { getAllByText } = await render(<PerformancePlayerScreen />);

      expect(getAllByText("PRÉPARATION").length).toBeGreaterThan(0);
    });
  });

  describe("Leaving the screen stops the engine", () => {
    it.each(["break", "playing", "paused"] as const)(
      "stops the competition on unmount while %s (swipe-back, reset…)",
      async (status) => {
        usePerformanceStore.getState().setStatus(status);
        const { unmount } = await render(<PerformancePlayerScreen />);
        await unmount();
        expect(mockPerformanceData.stopPerformance).toHaveBeenCalled();
      },
    );

    it.each(["idle", "finished"] as const)(
      "does not stop again when already %s",
      async (status) => {
        usePerformanceStore.getState().setStatus(status);
        const { unmount } = await render(<PerformancePlayerScreen />);
        await unmount();
        expect(mockPerformanceData.stopPerformance).not.toHaveBeenCalled();
      },
    );
  });

  describe("Auto-exit on Finish", () => {
    it("should navigate back when status is finished", async () => {
      // Arrange
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        status: "finished",
      });

      // Act
      await render(<PerformancePlayerScreen />);

      // Assert
      // The useEffect should trigger navigation.goBack()
      // Note: This might need to be tested with act() or waitFor()
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });

  describe("UI Rendering", () => {
    it("should display current heat information", async () => {
      // Act
      const { getByText, getByTestId } = await render(
        <PerformancePlayerScreen />,
      );

      // Assert
      expect(getByText("GROUPE 1/5")).toBeTruthy();
      expect(getByText("TOUR 1/2")).toBeTruthy();
      expect(getByTestId("performance-player-context")).toHaveTextContent(
        "Tour 1 · Latines · Samba · Groupe 1/5",
      );
    });

    it("should display current dance style", async () => {
      // Act
      const { getByText } = await render(<PerformancePlayerScreen />);

      // Assert
      expect(getByText("Samba")).toBeTruthy();
    });

    it("should display break phase correctly", async () => {
      // Arrange
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        activePhase: "break",
        timeRemaining: 30,
      });

      // Act
      const { getByText } = await render(<PerformancePlayerScreen />);

      // Assert
      expect(getByText("PAUSE")).toBeTruthy();
      expect(
        getByText("Suivant : Tour 1 · Latines · Cha-cha-cha · Groupe 2/5"),
      ).toBeTruthy();
    });

    it("shows that the announcement is being spoken", async () => {
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        activePhase: "break",
        isAnnouncing: true,
        timeRemaining: 0,
      });
      const { getByText } = await render(<PerformancePlayerScreen />);
      expect(getByText("Annonce en cours…")).toBeTruthy();
    });

    it("shows FINALE for a final round", async () => {
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        playlist: mockPerformanceData.playlist.map((i) => ({
          ...i,
          roundType: "Final" as const,
          totalGroups: 1,
          groupIndex: 1,
        })),
      });
      const { getByText } = await render(<PerformancePlayerScreen />);
      expect(getByText("FINALE")).toBeTruthy();
    });
  });

  describe("Time Formatting", () => {
    it("should format time correctly", async () => {
      // Arrange - 90 seconds = 1:30
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        timeRemaining: 90,
      });

      // Act
      const { getByText } = await render(<PerformancePlayerScreen />);

      // Assert
      expect(getByText("1:30")).toBeTruthy();
    });

    it("should pad seconds with zero when needed", async () => {
      // Arrange - 65 seconds = 1:05
      mockUsePerformance.mockReturnValue({
        ...mockPerformanceData,
        timeRemaining: 65,
      });

      // Act
      const { getByText } = await render(<PerformancePlayerScreen />);

      // Assert
      expect(getByText("1:05")).toBeTruthy();
    });
  });
});
