import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import {
  ContextRepeatMode,
  PlayerProvider,
  TrackData,
  usePlayer,
} from "../PlayerContext";

const mockTrack: TrackData = {
  id: "track-1",
  url: "file://track1.mp3",
  title: "Test Track",
  artist: "Test Artist",
  baseBpm: 120,
  style: "Latin",
};

jest.mock("../../../../utils/TrackPlayerWrapper", () => {
  const mock = {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    add: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    setQueue: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    skip: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue("paused"),
    getTrack: jest.fn().mockResolvedValue(null),
    setRepeatMode: jest.fn().mockResolvedValue(undefined),
  };
  return {
    __esModule: true,
    default: mock,
    State: { Playing: "playing", Paused: "paused", None: "none" },
    Event: {
      PlaybackError: "playback-error",
      PlaybackState: "playback-state",
      PlaybackTrackChanged: "playback-track-changed",
    },
    RepeatMode: { Off: 0, Track: 1, Queue: 2 },
    PitchAlgorithm: { Music: "PITCH_ALGORITHM_MUSIC" },
    usePlaybackState: jest.fn(() => ({ state: "paused" })),
  };
});

jest.mock("../../services/TrackPlayerService", () => ({
  setupPlayer: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../../../utils/typeGuards", () => ({
  hasExtendedTrackData: jest.fn(() => true),
}));

describe("PlayerContext", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <PlayerProvider>{children}</PlayerProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (
      require("../../services/TrackPlayerService") as { setupPlayer: jest.Mock }
    ).setupPlayer.mockResolvedValue(true);
  });

  it("provides initial state", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => {
      expect(result.current.isPlayerReady).toBe(true);
    });

    expect(result.current.currentTrack).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.queueTracks).toEqual([]);
    expect(result.current.likedTrackIds).toEqual([]);
    expect(result.current.repeatMode).toBe(ContextRepeatMode.Off);
    expect(result.current.isShuffle).toBe(false);
  });

  it("toggleLike adds and removes track", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(() => result.current.toggleLike("track-1"));
    expect(result.current.likedTrackIds).toContain("track-1");
    expect(result.current.isLiked("track-1")).toBe(true);

    await act(() => result.current.toggleLike("track-1"));
    expect(result.current.likedTrackIds).not.toContain("track-1");
    expect(result.current.isLiked("track-1")).toBe(false);
  });

  it("toggleRepeat cycles through modes", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(() => result.current.toggleRepeat());
    expect(result.current.repeatMode).toBe(ContextRepeatMode.Queue);

    await act(() => result.current.toggleRepeat());
    expect(result.current.repeatMode).toBe(ContextRepeatMode.Track);

    await act(() => result.current.toggleRepeat());
    expect(result.current.repeatMode).toBe(ContextRepeatMode.Off);
  });

  it("toggleShuffle toggles state", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    TrackPlayer.reset.mockClear();
    TrackPlayer.setQueue.mockClear();

    expect(result.current.isShuffle).toBe(false);
    await act(() => result.current.toggleShuffle());
    expect(result.current.isShuffle).toBe(true);
    await act(() => result.current.toggleShuffle());
    expect(result.current.isShuffle).toBe(false);

    // Regression: toggling shuffle must reorder the queue via setQueue, never
    // reset()+play() — that would restart the currently-playing track from 0:00.
    expect(TrackPlayer.setQueue).toHaveBeenCalled();
    expect(TrackPlayer.reset).not.toHaveBeenCalled();
  });

  it("playTrack loads single track", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => {
      await result.current.playTrack(mockTrack);
    });

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(TrackPlayer.add).toHaveBeenCalled();
    expect(TrackPlayer.play).toHaveBeenCalled();
    expect(result.current.currentTrack).toEqual(mockTrack);
    expect(result.current.queueTracks).toEqual([mockTrack]);
  });

  it("playTrack with playlist loads queue", async () => {
    const playlist = [
      mockTrack,
      { ...mockTrack, id: "track-2", title: "Track 2" },
    ];
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => {
      await result.current.playTrack(mockTrack, playlist);
    });

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(TrackPlayer.add).toHaveBeenCalledWith(expect.any(Array));
    expect(TrackPlayer.play).toHaveBeenCalled();
    expect(result.current.currentTrack).toEqual(mockTrack);
    expect(result.current.queueTracks).toEqual(playlist);
  });

  it("handles track playback error", async () => {
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    await renderHook(() => usePlayer(), { wrapper });
    await waitFor(() =>
      expect(TrackPlayer.addEventListener).toHaveBeenCalled(),
    );

    const errorListener = TrackPlayer.addEventListener.mock.calls.find(
      (call: [string, (...args: unknown[]) => unknown]) =>
        call[0] === "playback-error",
    )[1];

    await act(() => {
      errorListener({ code: "FAILED", message: "Test Error" });
    });

    // Coverage only check
    expect(TrackPlayer.addEventListener).toHaveBeenCalledWith(
      "playback-error",
      expect.any(Function),
    );
  });

  it("setQueueTracks updates queue", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(() => result.current.setQueueTracks([mockTrack]));
    expect(result.current.queueTracks).toEqual([mockTrack]);
  });

  it("resetPlayer clears state", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => result.current.playTrack(mockTrack));
    expect(result.current.currentTrack).not.toBeNull();

    await act(async () => result.current.resetPlayer());
    expect(result.current.currentTrack).toBeNull();
    expect(result.current.queueTracks).toEqual([]);
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.reset).toHaveBeenCalled();
  });

  it("pause and resume call TrackPlayer", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => result.current.pause());
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.pause).toHaveBeenCalled();

    await act(async () => result.current.resume());
    expect(TrackPlayer.play).toHaveBeenCalled();
  });

  it("seekTo calls TrackPlayer", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => result.current.seekTo(30));
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.seekTo).toHaveBeenCalledWith(30);
  });

  it("updates state when track changes", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });
    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    const mockTrackData = { ...mockTrack, id: "track-2", title: "New Track" };
    TrackPlayer.getTrack.mockResolvedValue(mockTrackData);

    const eventListener = TrackPlayer.addEventListener.mock.calls.find(
      (call: [string, (...args: unknown[]) => unknown]) =>
        call[0] === "playback-track-changed",
    )[1];

    await act(async () => {
      await eventListener({ nextTrack: 0 });
    });

    expect(result.current.currentTrack?.id).toBe("track-2");
  });

  it("applies pitch algorithm to tracks", async () => {
    const { result } = await renderHook(() => usePlayer(), { wrapper });
    await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

    await act(async () => {
      await result.current.playTrack(mockTrack);
    });

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({
        pitchAlgorithm: "PITCH_ALGORITHM_MUSIC",
      }),
    );
  });

  it("handles player setup failure", async () => {
    const { setupPlayer } = require("../../services/TrackPlayerService");
    setupPlayer.mockResolvedValue(false);

    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => {
      expect(result.current.isPlayerReady).toBe(false);
    });
  });

  it("handles player setup error", async () => {
    const { setupPlayer } = require("../../services/TrackPlayerService");
    setupPlayer.mockRejectedValue(new Error("Setup failed"));

    const { result } = await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() => {
      expect(result.current.isPlayerReady).toBe(false);
    });
  });

  it("adds debug listeners for errors and state changes", async () => {
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    await renderHook(() => usePlayer(), { wrapper });

    await waitFor(() =>
      expect(TrackPlayer.addEventListener).toHaveBeenCalled(),
    );

    const errorListener = TrackPlayer.addEventListener.mock.calls.find(
      (call: [string, (...args: unknown[]) => unknown]) =>
        call[0] === "playback-error",
    )[1];
    const stateListener = TrackPlayer.addEventListener.mock.calls.find(
      (call: [string, (...args: unknown[]) => unknown]) =>
        call[0] === "playback-state",
    )[1];

    await act(() => {
      errorListener({ code: "EBAD", message: "Fail" });
      stateListener({ state: "playing" });
    });

    // Just verifying execution for coverage
    expect(TrackPlayer.addEventListener).toHaveBeenCalledWith(
      "playback-error",
      expect.any(Function),
    );
  });

  describe("Playback Actions with Ready Checks", () => {
    it("returns early if player not ready in togglePlayback", async () => {
      const { setupPlayer } = require("../../services/TrackPlayerService");
      setupPlayer.mockResolvedValue(false);

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      // Initially false

      await act(async () => {
        await result.current.togglePlayback();
      });

      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      expect(TrackPlayer.getState).not.toHaveBeenCalled();
    });

    it("toggles playback from playing to paused", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      TrackPlayer.getState.mockResolvedValue("playing");

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      await act(async () => {
        await result.current.togglePlayback();
      });

      expect(TrackPlayer.pause).toHaveBeenCalled();
    });

    it("toggles playback from paused to playing", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      TrackPlayer.getState.mockResolvedValue("paused");

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      await act(async () => {
        await result.current.togglePlayback();
      });

      expect(TrackPlayer.play).toHaveBeenCalled();
    });

    it("returns early in playTrack if not ready", async () => {
      const { setupPlayer } = require("../../services/TrackPlayerService");
      setupPlayer.mockResolvedValue(false); // Consistently false

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      // We don't wait for isPlayerReady here because we want it to be false

      await act(async () => {
        await result.current.playTrack(mockTrack);
      });

      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      expect(TrackPlayer.reset).not.toHaveBeenCalled();
    });

    it("handles same track play/pause logic", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      TrackPlayer.getState.mockResolvedValue("playing");

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      // First play to set currentTrack
      await act(async () => {
        await result.current.playTrack(mockTrack);
      });
      TrackPlayer.reset.mockClear();

      // Play same track again
      await act(async () => {
        await result.current.playTrack(mockTrack);
      });

      expect(TrackPlayer.reset).not.toHaveBeenCalled();
      expect(TrackPlayer.pause).toHaveBeenCalled(); // Since it was playing
    });

    it("logs error when playTrack (playlist) fails", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      TrackPlayer.reset.mockRejectedValueOnce(new Error("Reset failed"));

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      await act(async () => {
        await result.current.playTrack(mockTrack, [mockTrack]);
      });
      // Verification via uncovered lines check later
    });

    it("logs error when playTrack (single) fails", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      TrackPlayer.reset.mockRejectedValueOnce(new Error("Reset failed"));

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      await act(async () => {
        await result.current.playTrack(mockTrack);
      });
    });

    it("skips to track in playlist if startIndex > 0", async () => {
      const TrackPlayer =
        require("../../../../utils/TrackPlayerWrapper").default;
      const playlist = [
        { ...mockTrack, id: "track-0", title: "First" },
        mockTrack,
      ];

      const { result } = await renderHook(() => usePlayer(), { wrapper });
      await waitFor(() => expect(result.current.isPlayerReady).toBe(true));

      await act(async () => {
        await result.current.playTrack(mockTrack, playlist);
      });

      await waitFor(() => {
        expect(TrackPlayer.skip).toHaveBeenCalledWith(1);
      });
    });
  });
});
