/**
 * Tests for the performance engine logic (formerly PerformanceContext).
 * The engine logic now lives in usePerformanceEngine hook.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import Tts from "../../../../services/TtsService";
import { usePerformanceEngine } from "../../hooks/usePerformanceEngine";

// Mock TtsService
jest.mock("../../../../services/TtsService", () => ({
  __esModule: true,
  default: {
    speak: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    preload: jest.fn().mockResolvedValue("/tmp/announcement.mp3"),
  },
}));

// Mock dependencies
const mockTracks = [
  {
    id: "1",
    title: "Samba Track",
    artist: "Artist",
    url: "file://samba.mp3",
    baseBpm: 30,
    style: "Samba",
    artwork: undefined,
    playlist: "Tout",
  },
  {
    id: "2",
    title: "Ambiance Track",
    artist: "Artist",
    url: "file://ambiance.mp3",
    baseBpm: 0,
    style: "Ambiance",
    artwork: undefined,
    playlist: "Tout",
  },
];

jest.mock("../../../player/context/LibraryContext", () => ({
  useLibrary: jest.fn(() => ({
    allTracks: mockTracks,
  })),
}));

jest.mock("../../../player/context/PlayerContext", () => ({
  usePlayer: jest.fn(() => ({
    playTrack: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    resetPlayer: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("PerformanceContext (usePerformanceEngine)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Reset zustand store between tests
    const {
      usePerformanceStore,
    } = require("../../../../stores/performance.store");
    usePerformanceStore.setState({
      config: {
        mode: "Round",
        category: "Latin",
        selectedDances: ["Samba", "Cha-Cha-Cha", "Rumba", "Paso Doble", "Jive"],
        duration: 90,
        pauseDuration: 15,
        pasoClashes: 2,
        numberOfHeats: 1,
      },
      playlist: [],
      currentDanceIndex: 0,
      status: "idle",
      activePhase: "dance",
      timeRemaining: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs the performance flow from idle to finished and handles faders", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());

    await act(() => {
      result.current.setConfig({
        selectedDances: ["Samba"],
        duration: 90,
        pauseDuration: 10,
        mode: "Round",
        category: "Latin",
        numberOfHeats: 1,
        pasoClashes: 2,
      });
    });

    await act(async () => {
      await result.current.startPerformance();
    });

    expect(result.current.status).toBe("break");

    // Skip initial break (10s)
    for (let i = 0; i < 11; i++) {
      await act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    await waitFor(() => {
      expect(result.current.status).toBe("playing");
    });

    // Advance 90s of dance -> enter break
    for (let i = 0; i < 91; i++) {
      await act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    await waitFor(() => {
      expect(result.current.status).toBe("break");
    });

    // Finish final break (10s) -> finished
    for (let i = 0; i < 11; i++) {
      await act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
  });

  it("handles heat ordinals and TTS failure", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());

    await act(() => {
      result.current.setConfig((prev) => ({
        ...prev,
        selectedDances: ["Samba"],
        numberOfHeats: 2,
      }));
    });

    await act(async () => {
      await result.current.startPerformance();
    });

    // Trigger first heat announcement
    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(Tts.speak).toHaveBeenCalledWith(
      expect.stringContaining("First Heat"),
      expect.anything(),
    );

    // Mock TTS failure for next heat
    (Tts.speak as jest.Mock).mockRejectedValueOnce(new Error("TTS Dead"));

    // Skip to next break (10s break + 90s dance = 100s)
    for (let i = 0; i < 101; i++) {
      await act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    await waitFor(() => {
      expect(result.current.status).toBe("break");
    });

    // Trigger second heat announcement
    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });
  });

  it("handles empty tracks gracefully", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());

    await act(() => {
      result.current.setConfig((prev) => ({
        ...prev,
        selectedDances: ["Unknown"],
      }));
    });

    await act(async () => {
      await result.current.startPerformance();
    });

    expect(result.current.status).toBe("idle");
  });

  it("handles manual stop and toggle play/pause", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());
    await act(async () => {
      await result.current.startPerformance();
    });

    await act(() => {
      result.current.togglePlayPause();
    });
    expect(result.current.status).toBe("paused");

    await act(() => {
      result.current.togglePlayPause();
    });
    expect(result.current.status).toBe("break");

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await result.current.stopPerformance();
    });
    expect(result.current.status).toBe("idle");
  });
});
