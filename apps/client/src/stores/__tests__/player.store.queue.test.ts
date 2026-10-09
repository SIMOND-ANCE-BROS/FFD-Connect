import { TrackData, usePlayerStore } from "../player.store";

jest.mock("../../utils/TrackPlayerWrapper", () => {
  const mock = {
    add: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    setQueue: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    skip: jest.fn().mockResolvedValue(undefined),
    setRepeatMode: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue("paused"),
  };
  return {
    __esModule: true,
    default: mock,
    State: { Playing: "playing", Paused: "paused", None: "none" },
    RepeatMode: { Off: 0, Track: 1, Queue: 2 },
    PitchAlgorithm: { Music: "PITCH_ALGORITHM_MUSIC" },
  };
});

jest.mock("../../features/player/services/TrackPlayerService", () => ({
  setupPlayer: jest.fn().mockResolvedValue(true),
}));

const TrackPlayer = jest.requireMock<{
  default: Record<string, jest.Mock>;
}>("../../utils/TrackPlayerWrapper").default;

const t = (id: string): TrackData => ({
  id,
  url: `https://cdn/${id}.mp3`,
  title: `Title ${id}`,
  artist: "Artist",
  baseBpm: 120,
});

const ids = (queue: TrackData[]) => queue.map((track) => track.id);

/** Ids pushed to the native queue by the last setQueue call + its index. */
const lastNativeQueue = () => {
  const calls = TrackPlayer.setQueue.mock.calls as [{ id: string }[], number][];
  const [tracks, index] = calls[calls.length - 1];
  return { ids: tracks.map((track) => track.id), index };
};

describe("player.store queue editing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.getState()._resetForTests();
  });

  const playing = (current: string, queue: string[]) => {
    usePlayerStore.setState({
      currentTrack: t(current),
      queueTracks: queue.map(t),
      isPlayerReady: true,
    });
  };

  describe("playNext", () => {
    it("inserts after the current track and syncs the native queue in place", async () => {
      playing("b", ["a", "b", "c"]);

      const result = await usePlayerStore.getState().playNext(t("x"));

      expect(result).toBe("queued");
      expect(ids(usePlayerStore.getState().queueTracks)).toEqual([
        "a",
        "b",
        "x",
        "c",
      ]);
      // Current track keeps playing: no reset, no reload, index = current.
      expect(lastNativeQueue()).toEqual({
        ids: ["a", "b", "x", "c"],
        index: 1,
      });
      expect(TrackPlayer.reset).not.toHaveBeenCalled();
      expect(TrackPlayer.skip).not.toHaveBeenCalled();
    });

    it("starts playback with the track when nothing is loaded", async () => {
      const result = await usePlayerStore.getState().playNext(t("x"));

      expect(result).toBe("started");
      expect(usePlayerStore.getState().currentTrack?.id).toBe("x");
      expect(ids(usePlayerStore.getState().queueTracks)).toEqual(["x"]);
      expect(TrackPlayer.reset).toHaveBeenCalled();
      expect(TrackPlayer.play).toHaveBeenCalled();
    });

    it("reports a failure when the track cannot start", async () => {
      const result = await usePlayerStore
        .getState()
        .playNext({ ...t("x"), url: "" });

      expect(result).toBe("failed");
      expect(usePlayerStore.getState().currentTrack).toBeNull();
    });

    it("is a no-op for the track already playing", async () => {
      playing("a", ["a", "b"]);

      const result = await usePlayerStore.getState().playNext(t("a"));

      expect(result).toBe("unchanged");
      expect(ids(usePlayerStore.getState().queueTracks)).toEqual(["a", "b"]);
      expect(TrackPlayer.setQueue).not.toHaveBeenCalled();
    });

    it("builds on the current track when the queue is still empty", async () => {
      usePlayerStore.setState({ currentTrack: t("a"), queueTracks: [] });

      await usePlayerStore.getState().playNext(t("x"));

      expect(ids(usePlayerStore.getState().queueTracks)).toEqual(["a", "x"]);
    });
  });

  describe("addToQueue", () => {
    it("appends at the end and syncs the native queue", async () => {
      playing("a", ["a", "b"]);

      const result = await usePlayerStore.getState().addToQueue(t("x"));

      expect(result).toBe("queued");
      expect(ids(usePlayerStore.getState().queueTracks)).toEqual([
        "a",
        "b",
        "x",
      ]);
      expect(lastNativeQueue()).toEqual({ ids: ["a", "b", "x"], index: 0 });
    });

    it("also adds the track to the pre-shuffle order when shuffling", async () => {
      usePlayerStore.setState({
        currentTrack: t("b"),
        queueTracks: [t("b"), t("c"), t("a")],
        _originalQueue: [t("a"), t("b"), t("c")],
        isShuffle: true,
      });

      await usePlayerStore.getState().addToQueue(t("x"));
      await usePlayerStore.getState().playNext(t("y"));

      const state = usePlayerStore.getState();
      expect(ids(state.queueTracks)).toEqual(["b", "y", "c", "a", "x"]);
      expect(ids(state._originalQueue)).toEqual(["a", "b", "y", "c", "x"]);

      // Turning shuffle off keeps the added tracks.
      state.toggleShuffle();
      expect(ids(usePlayerStore.getState().queueTracks)).toEqual([
        "a",
        "b",
        "y",
        "c",
        "x",
      ]);
    });

    it("leaves the pre-shuffle order alone when not shuffling", async () => {
      playing("a", ["a"]);

      await usePlayerStore.getState().addToQueue(t("x"));

      expect(usePlayerStore.getState()._originalQueue).toEqual([]);
    });
  });

  describe("moveQueueTrack", () => {
    it("reorders and keeps the native index on the current track", () => {
      playing("b", ["a", "b", "c", "d"]);

      usePlayerStore.getState().moveQueueTrack(3, 0);

      expect(ids(usePlayerStore.getState().queueTracks)).toEqual([
        "d",
        "a",
        "b",
        "c",
      ]);
      expect(lastNativeQueue()).toEqual({
        ids: ["d", "a", "b", "c"],
        index: 2,
      });
      expect(TrackPlayer.reset).not.toHaveBeenCalled();
    });

    it("moving the current track updates its native index", () => {
      playing("a", ["a", "b", "c"]);

      usePlayerStore.getState().moveQueueTrack(0, 2);

      expect(lastNativeQueue()).toEqual({ ids: ["b", "c", "a"], index: 2 });
    });

    it("ignores no-op moves", () => {
      playing("a", ["a", "b"]);
      const before = usePlayerStore.getState().queueTracks;

      usePlayerStore.getState().moveQueueTrack(1, 1);

      expect(usePlayerStore.getState().queueTracks).toBe(before);
      expect(TrackPlayer.setQueue).not.toHaveBeenCalled();
    });

    it("does not touch the native player without a current track", () => {
      usePlayerStore.setState({ queueTracks: [t("a"), t("b")] });

      usePlayerStore.getState().moveQueueTrack(0, 1);

      expect(ids(usePlayerStore.getState().queueTracks)).toEqual(["b", "a"]);
      expect(TrackPlayer.setQueue).not.toHaveBeenCalled();
    });
  });

  describe("removeFromQueue", () => {
    it("removes an upcoming track from both queues and syncs natively", () => {
      usePlayerStore.setState({
        currentTrack: t("a"),
        queueTracks: [t("a"), t("b"), t("c")],
        _originalQueue: [t("c"), t("a"), t("b")],
      });

      usePlayerStore.getState().removeFromQueue("b");

      const state = usePlayerStore.getState();
      expect(ids(state.queueTracks)).toEqual(["a", "c"]);
      expect(ids(state._originalQueue)).toEqual(["c", "a"]);
      expect(lastNativeQueue()).toEqual({ ids: ["a", "c"], index: 0 });
    });

    it("leaves the native queue to the caller when removing the current track", () => {
      playing("a", ["a", "b"]);

      usePlayerStore.getState().removeFromQueue("a");

      expect(ids(usePlayerStore.getState().queueTracks)).toEqual(["b"]);
      expect(TrackPlayer.setQueue).not.toHaveBeenCalled();
    });
  });

  it("logs instead of throwing when the native sync fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    TrackPlayer.setQueue.mockRejectedValueOnce(new Error("native"));
    playing("a", ["a"]);

    await expect(usePlayerStore.getState().addToQueue(t("x"))).resolves.toBe(
      "queued",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
