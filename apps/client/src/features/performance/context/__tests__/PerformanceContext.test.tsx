/**
 * usePerformanceEngine is a thin binding between the screens, the Zustand
 * store and the singleton engine (engine/competitionController, tested on its
 * own). These tests cover the binding.
 */
import { act, renderHook } from "@testing-library/react-native";
import * as engine from "../../engine/competitionController";
import { usePerformanceEngine } from "../../hooks/usePerformanceEngine";
import { usePerformanceStore } from "../../../../stores/performance.store";

jest.mock("../../engine/competitionController", () => ({
  setEngineDeps: jest.fn(),
  startPerformance: jest.fn(() => Promise.resolve(true)),
  stopPerformance: jest.fn(() => Promise.resolve()),
  nextStep: jest.fn(() => Promise.resolve()),
  previousStep: jest.fn(),
  togglePlayPause: jest.fn(() => Promise.resolve()),
  fadeNow: jest.fn(),
  generatePlaylist: jest.fn(),
}));

const mockTracks = [
  {
    id: "1",
    title: "Samba Track",
    artist: "Artist",
    url: "https://x/samba.mp3",
    baseBpm: 30,
    style: "Samba",
  },
];
const mockRepo = { getTracksPage: jest.fn() };

jest.mock("../../../player/context/LibraryContext", () => ({
  useLibrary: () => ({ allTracks: mockTracks }),
}));
jest.mock("../../../player/context/TrackContext", () => ({
  useTrackRepository: () => mockRepo,
}));
const mockPlayer = {
  playTrack: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  resetPlayer: jest.fn(),
  ensurePlayerReady: jest.fn(),
};
jest.mock("../../../player/context/PlayerContext", () => ({
  usePlayer: () => mockPlayer,
}));

describe("usePerformanceEngine (binding)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hands the player, library and repository to the engine", async () => {
    await renderHook(() => usePerformanceEngine());
    expect(engine.setEngineDeps).toHaveBeenCalledWith({
      ...mockPlayer,
      allTracks: mockTracks,
      trackRepo: mockRepo,
    });
  });

  it("exposes the store state, including loading progress", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());
    await act(() => {
      usePerformanceStore.getState().setStatus("loading");
      usePerformanceStore.getState().setLoadingProgress({ done: 1, total: 4 });
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.loadingProgress).toEqual({ done: 1, total: 4 });
    expect(result.current.config.rounds[0].groups).toHaveLength(2);
    await act(() => {
      usePerformanceStore.getState().setStatus("idle");
      usePerformanceStore.getState().setLoadingProgress(null);
    });
  });

  it("delegates the actions to the engine", async () => {
    const { result } = await renderHook(() => usePerformanceEngine());
    await expect(result.current.startPerformance()).resolves.toBe(true);
    result.current.togglePlayPause();
    result.current.nextStep();
    result.current.previousStep();
    result.current.stopPerformance();
    result.current.fadeNow();
    result.current.generatePlaylist();
    expect(engine.togglePlayPause).toHaveBeenCalled();
    expect(engine.nextStep).toHaveBeenCalled();
    expect(engine.previousStep).toHaveBeenCalled();
    expect(engine.stopPerformance).toHaveBeenCalled();
    expect(engine.fadeNow).toHaveBeenCalled();
    expect(engine.generatePlaylist).toHaveBeenCalled();
  });

  it("can be mounted twice without duplicating the engine (singleton)", async () => {
    await renderHook(() => usePerformanceEngine());
    await renderHook(() => usePerformanceEngine());
    // Only dependencies are (re)registered; no per-instance timer exists.
    expect(engine.setEngineDeps).toHaveBeenCalledTimes(2);
    expect(engine.startPerformance).not.toHaveBeenCalled();
  });
});
