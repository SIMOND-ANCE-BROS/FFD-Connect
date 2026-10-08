import { act, renderHook } from "@testing-library/react-native";
import { mockNavigation } from "../../../../__tests__/mocks/mockNavigation";
import { ContextRepeatMode, usePlayer } from "../../context/PlayerContext";
import { usePlayerStore } from "../../../../stores/player.store";
import { useAudioPlayerLogic } from "../useAudioPlayerLogic";

jest.mock("../../context/PlayerContext");
jest.mock("../../../../utils/TrackPlayerWrapper", () => {
  const setRate = jest.fn().mockResolvedValue(undefined);
  const seekTo = jest.fn().mockResolvedValue(undefined);
  const setVolume = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    default: { setRate, seekTo, setVolume },
    useProgress: () => ({ position: 0, duration: 120, buffered: 0 }),
  };
});
jest.mock("../../../../hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({ handleError: jest.fn((err) => err) }),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

describe("useAudioPlayerLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.getState()._resetForTests();
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    TrackPlayer.setRate.mockResolvedValue?.(undefined);
    TrackPlayer.seekTo.mockResolvedValue?.(undefined);
  });

  it("uses queue tracks from player context and plays selected item", async () => {
    // Arrange
    const queueTracks = [
      {
        id: "1",
        title: "Track One",
        artist: "Artist",
        url: "file://one.mp3",
        baseBpm: 120,
        artwork: undefined,
        playlist: "Favoris",
      },
      {
        id: "2",
        title: "Track Two",
        artist: "Artist",
        url: "file://two.mp3",
        baseBpm: 124,
        artwork: undefined,
        playlist: "Favoris",
      },
    ];

    const playTrack = jest.fn();
    const setQueueTracks = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks,
    });

    // Act
    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(async () => {
      await result.current.actions.playQueueTrack("2");
    });

    // Assert
    expect(result.current.state.tracks).toHaveLength(2);
    expect(playTrack).toHaveBeenCalledWith(queueTracks[1], queueTracks);
  });

  it("does not replay the same track when shuffle is on", async () => {
    // Arrange
    const queueTracks = [
      {
        id: "1",
        title: "Track One",
        artist: "Artist",
        url: "file://one.mp3",
        baseBpm: 120,
        artwork: undefined,
        playlist: "Tout",
      },
      {
        id: "2",
        title: "Track Two",
        artist: "Artist",
        url: "file://two.mp3",
        baseBpm: 124,
        artwork: undefined,
        playlist: "Tout",
      },
    ];

    const playTrack = jest.fn();
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: true,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const randomSpy = jest
      .spyOn(Math, "random")
      .mockReturnValueOnce(0) // picks index 0 (current)
      .mockReturnValueOnce(0.9); // picks index 1

    // Act
    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => {
      result.current.actions.handleNext();
    });

    // Assert
    expect(playTrack).toHaveBeenCalledWith(queueTracks[1], queueTracks);
    randomSpy.mockRestore();
  });

  it("returns default state when no track", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: false,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    expect(result.current.state.currentTrack.title).toBe("No Track");
    expect(result.current.state.bpm).toBe(120);
    expect(result.current.state.baseMpm).toBe(120);
  });

  it("changeBpm updates rate when player ready", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: { id: "1", title: "T", artist: "A", url: "", baseBpm: 120 },
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(async () => {
      await result.current.actions.changeBpm(140);
    });

    expect(result.current.state.bpm).toBe(140);
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.setRate).toHaveBeenCalled();
  });

  it("resetBpm restores base BPM", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: { id: "1", title: "T", artist: "A", url: "", baseBpm: 120 },
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(async () => {
      await result.current.actions.resetBpm();
    });

    expect(result.current.state.bpm).toBe(120);
  });

  it("seekTo calls TrackPlayer when ready", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: { id: "1", title: "T", artist: "A", url: "", baseBpm: 120 },
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(async () => {
      await result.current.actions.seekTo(60);
    });

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.seekTo).toHaveBeenCalledWith(60);
  });

  it("openQueue and closeQueue toggle visibility", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: false,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    expect(result.current.state.isQueueVisible).toBe(false);

    await act(() => result.current.actions.openQueue());
    expect(result.current.state.isQueueVisible).toBe(true);

    await act(() => result.current.actions.closeQueue());
    expect(result.current.state.isQueueVisible).toBe(false);
  });

  it("removeQueueTrack updates queue", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const setQueueTracks = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[1],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: "off",
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks,
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(() => result.current.actions.removeQueueTrack("2"));

    expect(setQueueTracks).toHaveBeenCalled();
  });

  it("handleNext with repeat Track stays on same track", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Track,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handleNext());

    expect(playTrack).toHaveBeenCalledWith(queueTracks[0], queueTracks);
  });

  it("handleNext with repeat Queue wraps to first when at end", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[1],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Queue,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handleNext());

    expect(playTrack).toHaveBeenCalledWith(queueTracks[0], queueTracks);
  });

  it("handleNext with no repeat at end does nothing", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handleNext());

    expect(playTrack).not.toHaveBeenCalled();
  });

  it("handleNext with shuffle and single track does nothing", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: true,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handleNext());

    expect(playTrack).not.toHaveBeenCalled();
  });

  it("handlePrev with repeat Track replays same track", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[1],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Track,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handlePrev());

    expect(playTrack).toHaveBeenCalledWith(queueTracks[1], queueTracks);
  });

  it("handlePrev wraps to end when at first track", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const playTrack = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.handlePrev());

    expect(playTrack).toHaveBeenCalledWith(queueTracks[1], queueTracks);
  });

  it("changeBpm does not call setRate when player not ready", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: { id: "1", title: "T", artist: "A", url: "", baseBpm: 120 },
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: false,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(async () => {
      await result.current.actions.changeBpm(140);
    });

    // Nothing applied → the display stays on the real tempo.
    expect(result.current.state.bpm).toBe(120);
    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.setRate).not.toHaveBeenCalled();
  });

  it("seekTo does not call TrackPlayer when not ready", async () => {
    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: { id: "1", title: "T", artist: "A", url: "", baseBpm: 120 },
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: false,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [],
      setQueueTracks: jest.fn(),
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());

    await act(async () => {
      await result.current.actions.seekTo(60);
    });

    const TrackPlayer = require("../../../../utils/TrackPlayerWrapper").default;
    expect(TrackPlayer.seekTo).not.toHaveBeenCalled();
  });

  it("removeQueueTrack calls resetPlayer when removing current and queue becomes empty", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
    ];
    const resetPlayer = jest.fn().mockResolvedValue(undefined);
    const setQueueTracks = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer,
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks,
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.removeQueueTrack("1"));

    expect(setQueueTracks).toHaveBeenCalled();
    expect(resetPlayer).toHaveBeenCalled();
  });

  it("removeQueueTrack plays next track when removing current with other tracks", async () => {
    const queueTracks = [
      { id: "1", title: "A", artist: "X", url: "", baseBpm: 120 },
      { id: "2", title: "B", artist: "X", url: "", baseBpm: 124 },
    ];
    const playTrack = jest.fn();
    const setQueueTracks = jest.fn();

    (usePlayer as jest.Mock).mockReturnValue({
      currentTrack: queueTracks[0],
      isPlaying: false,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack,
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks,
      setQueueTracks,
    });

    const { result } = await renderHook(() => useAudioPlayerLogic());
    await act(() => result.current.actions.removeQueueTrack("1"));

    expect(setQueueTracks).toHaveBeenCalled();
    expect(playTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: "2" }),
      expect.arrayContaining([expect.objectContaining({ id: "2" })]),
    );
  });

  describe("tempo lock", () => {
    const trackA = { id: "a", title: "A", artist: "X", url: "", baseBpm: 30 };
    const trackB = { id: "b", title: "B", artist: "X", url: "", baseBpm: 28 };
    const playerWith = (currentTrack: typeof trackA) => ({
      currentTrack,
      isPlaying: true,
      togglePlayback: jest.fn(),
      isPlayerReady: true,
      playTrack: jest.fn(),
      resetPlayer: jest.fn(),
      isLiked: jest.fn(() => false),
      toggleLike: jest.fn(),
      repeatMode: ContextRepeatMode.Off,
      toggleRepeat: jest.fn(),
      isShuffle: false,
      toggleShuffle: jest.fn(),
      queueTracks: [trackA, trackB],
      setQueueTracks: jest.fn(),
    });
    const TrackPlayer = () =>
      require("../../../../utils/TrackPlayerWrapper").default as {
        setRate: jest.Mock;
      };

    it("plays the next track at the locked MPM, slider included", async () => {
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackA));
      const { result, rerender } = await renderHook(() =>
        useAudioPlayerLogic(),
      );
      await act(async () => {
        await result.current.actions.changeBpm(27);
      });
      await act(async () => {
        result.current.actions.toggleTempoLock();
      });

      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackB));
      await act(async () => {
        await rerender({});
      });

      expect(result.current.state.isTempoLocked).toBe(true);
      expect(result.current.state.bpm).toBe(27);
      expect(result.current.state.bpmDiff).toBe(-1);
      expect(TrackPlayer().setRate).toHaveBeenLastCalledWith(27 / 28);
    });

    it("clamps the locked MPM to the new track's ±50% range", async () => {
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackA));
      const { result, rerender } = await renderHook(() =>
        useAudioPlayerLogic(),
      );
      await act(async () => {
        await result.current.actions.changeBpm(44);
      });
      await act(async () => {
        result.current.actions.toggleTempoLock();
      });
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackB));
      await act(async () => {
        await rerender({});
      });
      expect(result.current.state.bpm).toBe(42);
    });

    it("without the lock, a new track starts at its original tempo", async () => {
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackA));
      const { result, rerender } = await renderHook(() =>
        useAudioPlayerLogic(),
      );
      await act(async () => {
        await result.current.actions.changeBpm(25);
      });
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackB));
      await act(async () => {
        await rerender({});
      });
      expect(result.current.state.bpm).toBe(28);
      expect(TrackPlayer().setRate).toHaveBeenLastCalledWith(1);
    });

    it("keeps the tempo and the lock when the screen is reopened", async () => {
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackA));
      const first = await renderHook(() => useAudioPlayerLogic());
      await act(async () => {
        await first.result.current.actions.changeBpm(33);
      });
      await act(async () => {
        first.result.current.actions.toggleTempoLock();
      });
      await first.unmount();
      TrackPlayer().setRate.mockClear();

      const { result } = await renderHook(() => useAudioPlayerLogic());
      expect(result.current.state.bpm).toBe(33);
      expect(result.current.state.isTempoLocked).toBe(true);
      expect(TrackPlayer().setRate).not.toHaveBeenCalled();
    });

    it("toggling the lock never changes the tempo", async () => {
      (usePlayer as jest.Mock).mockReturnValue(playerWith(trackA));
      const { result } = await renderHook(() => useAudioPlayerLogic());
      await act(async () => {
        await result.current.actions.changeBpm(32);
      });
      TrackPlayer().setRate.mockClear();
      await act(async () => {
        result.current.actions.toggleTempoLock();
      });
      await act(async () => {
        result.current.actions.toggleTempoLock();
      });
      expect(result.current.state.bpm).toBe(32);
      expect(TrackPlayer().setRate).not.toHaveBeenCalled();
    });
  });
});
