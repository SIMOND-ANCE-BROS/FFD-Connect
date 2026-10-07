import { Alert } from "react-native";
import Tts from "../../../../services/TtsService";
import {
  createRound,
  usePerformanceStore,
  type PerformanceConfig,
} from "../../../../stores/performance.store";
import TrackPlayer, { State } from "../../../../utils/TrackPlayerWrapper";
import type { TrackData } from "../../../player/context/PlayerContext";
import { cacheTrack } from "../../services/competitionAudioCache";
import { loadCompetitionLibrary } from "../../services/competitionLibrary";
import { CLOSING_ANNOUNCEMENT } from "../../utils/competitionProgram";
import * as engine from "../competitionController";

jest.mock("../../../../services/TtsService", () => ({
  __esModule: true,
  default: {
    speak: jest.fn(),
    stop: jest.fn(),
    preload: jest.fn(),
  },
}));

type StateListener = (data: { state: number }) => void;
const mockStateListeners = new Set<StateListener>();
jest.mock("../../../../utils/TrackPlayerWrapper", () => ({
  __esModule: true,
  Event: { PlaybackState: "playback-state" },
  State: { None: 0, Paused: 2, Playing: 3 },
  RepeatMode: { Off: 0, Track: 1, Queue: 2 },
  default: {
    setVolume: jest.fn(() => Promise.resolve()),
    setRepeatMode: jest.fn(() => Promise.resolve()),
    getState: jest.fn(() => Promise.resolve(3)),
    addEventListener: jest.fn((_e: string, l: StateListener) => {
      mockStateListeners.add(l);
      return { remove: () => mockStateListeners.delete(l) };
    }),
  },
}));

jest.mock("../../services/competitionLibrary", () => ({
  loadCompetitionLibrary: jest.fn(),
}));

jest.mock("../../services/competitionAudioCache", () => ({
  ...jest.requireActual<object>("../../services/competitionAudioCache"),
  cacheTrack: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const t = (id: string, style: string): TrackData => ({
  id,
  title: `${style} ${id}`,
  artist: "Artiste",
  url: `https://static/uploads/${id}.mp3`,
  baseBpm: 30,
  style,
});

const SAMBA = t("s1", "Samba");
const JIVE = t("j1", "Jive");
const AMBIANCE = { ...t("a1", "Ambiance"), title: "Ambiance lounge" };

const deps = {
  playTrack: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  resume: jest.fn(() => Promise.resolve()),
  resetPlayer: jest.fn(() => Promise.resolve()),
  ensurePlayerReady: jest.fn(() => Promise.resolve(true)),
  allTracks: [] as TrackData[],
  trackRepo: null,
};

const store = () => usePerformanceStore.getState();

const setProgram = (patch: Partial<PerformanceConfig> = {}) => {
  const round = createRound("Latin", "Final");
  store().setConfig({
    rounds: [{ ...round, selectedDances: ["Samba"] }],
    duration: 4,
    pauseDuration: 3,
    pasoClashes: 2,
    ...patch,
  });
};

const lastVolume = () => {
  const calls = (TrackPlayer.setVolume as jest.Mock).mock.calls;
  return calls[calls.length - 1]?.[0] as number | undefined;
};

/** Advance fake time second by second, flushing promises in between. */
const advance = async (ms: number) => {
  await jest.advanceTimersByTimeAsync(ms);
};

describe("competitionController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStateListeners.clear();
    engine.resetEngineForTests();
    engine.setEngineDeps(deps);
    usePerformanceStore.setState({
      playlist: [],
      currentDanceIndex: 0,
      status: "idle",
      activePhase: "dance",
      timeRemaining: 0,
      loadingProgress: null,
      isAnnouncing: false,
    });
    setProgram();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
      tracks: [SAMBA, JIVE],
      ambiance: [AMBIANCE],
    });
    (cacheTrack as jest.Mock).mockImplementation((track: TrackData) =>
      Promise.resolve(`file:///cache/${track.id}.mp3`),
    );
    (Tts.preload as jest.Mock).mockImplementation((text: string) =>
      Promise.resolve(`file:///cache/tts_${text.length}.mp3`),
    );
    (Tts.speak as jest.Mock).mockResolvedValue(undefined);
    (Tts.stop as jest.Mock).mockResolvedValue(undefined);
    (TrackPlayer.getState as jest.Mock).mockResolvedValue(State.Playing);
  });

  afterEach(async () => {
    await engine.stopPerformance();
    jest.useRealTimers();
  });

  describe("loading", () => {
    it("downloads every track, the ambiance and every announcement BEFORE leaving loading", async () => {
      setProgram({
        rounds: [
          {
            ...createRound("Latin", "Round"),
            selectedDances: ["Samba", "Jive"],
          },
        ],
      });
      const pending: (() => void)[] = [];
      (cacheTrack as jest.Mock).mockImplementation(
        (track: TrackData) =>
          new Promise<string>((resolve) => {
            pending.push(() => resolve(`file:///cache/${track.id}.mp3`));
          }),
      );

      const started = engine.startPerformance();
      await advance(0);

      expect(store().status).toBe("loading");
      expect(deps.playTrack).not.toHaveBeenCalled();
      expect(store().loadingProgress?.total).toBeGreaterThan(0);

      // Resolve downloads progressively (concurrency-limited pool).
      while (pending.length > 0) {
        pending.shift()?.();
        await advance(0);
      }
      await expect(started).resolves.toBe(true);

      // 2 unique dance tracks + 1 ambiance
      expect((cacheTrack as jest.Mock).mock.calls.map((c) => c[0].id)).toEqual(
        expect.arrayContaining(["s1", "j1", "a1"]),
      );
      // 4 announcements (2 dances × 2 heats) + closing line
      expect(Tts.preload).toHaveBeenCalledTimes(5);
      expect(Tts.preload).toHaveBeenCalledWith(CLOSING_ANNOUNCEMENT);

      expect(store().status).toBe("break");
      expect(store().loadingProgress).toBeNull();
      // Every item plays from the local cache with its preloaded announcement.
      const list = store().playlist;
      expect(list).toHaveLength(4);
      expect(list.every((i) => String(i.track.url).startsWith("file://"))).toBe(
        true,
      );
      expect(list.every((i) => Boolean(i.announcementPath))).toBe(true);
      expect(list[0].announcementText).toMatch(/Samba/);
    });

    it("fails the start with a French alert when a track cannot be downloaded", async () => {
      const { TrackDownloadError } = jest.requireActual<
        typeof import("../../services/competitionAudioCache")
      >("../../services/competitionAudioCache");
      (cacheTrack as jest.Mock).mockImplementation((track: TrackData) =>
        track.id === "s1"
          ? Promise.reject(new TrackDownloadError(track))
          : Promise.resolve(`file:///cache/${track.id}.mp3`),
      );

      await expect(engine.startPerformance()).resolves.toBe(false);

      expect(store().status).toBe("idle");
      expect(deps.playTrack).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Chargement impossible",
        expect.stringContaining("Samba s1"),
      );
    });

    it("stops with the TTS alert when an announcement cannot be generated", async () => {
      (Tts.preload as jest.Mock).mockImplementation((text: string) =>
        text === CLOSING_ANNOUNCEMENT
          ? Promise.resolve("x")
          : Promise.reject(new Error("TTS indisponible (500)")),
      );
      await expect(engine.startPerformance()).resolves.toBe(false);
      expect(store().status).toBe("idle");
      expect(Alert.alert).toHaveBeenCalledWith(
        "TTS indisponible",
        "TTS indisponible (500)",
      );
    });

    it("lists missing dances instead of starting", async () => {
      setProgram({
        rounds: [
          {
            ...createRound("Standard", "Final"),
            selectedDances: ["Tango", "Quickstep"],
          },
        ],
      });
      await expect(engine.startPerformance()).resolves.toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Musiques manquantes",
        expect.stringContaining("Tango, Quickstep"),
      );
      expect(cacheTrack).not.toHaveBeenCalled();
    });

    it("rejects a round without dance", async () => {
      setProgram({
        rounds: [{ ...createRound("Latin", "Round"), selectedDances: [] }],
      });
      await expect(engine.startPerformance()).resolves.toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Programme incomplet",
        expect.stringContaining("tour 1"),
      );
    });

    it("starts with silent breaks when no ambiance track exists", async () => {
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [SAMBA],
        ambiance: [],
      });
      await expect(engine.startPerformance()).resolves.toBe(true);
      expect(deps.playTrack).not.toHaveBeenCalled();
      expect(deps.pause).toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  describe("stop / restart races", () => {
    const deferred = <T>() => {
      let resolve: (v: T) => void = () => {};
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    it("refuses a double start", async () => {
      const first = engine.startPerformance();
      const second = engine.startPerformance();
      await expect(second).resolves.toBe(false);
      await expect(first).resolves.toBe(true);
      expect(loadCompetitionLibrary).toHaveBeenCalledTimes(1);
    });

    it("stop during loading drops the downloads, then a restart works", async () => {
      const gate = deferred<void>();
      (cacheTrack as jest.Mock).mockImplementation(async (track: TrackData) => {
        await gate.promise;
        return `file:///cache/${track.id}.mp3`;
      });

      const first = engine.startPerformance();
      await advance(0);
      expect(store().status).toBe("loading");

      await engine.stopPerformance(); // « Annuler »
      gate.resolve();
      await expect(first).resolves.toBe(false);
      expect(store().status).toBe("idle");
      expect(store().playlist).toEqual([]);
      expect(deps.playTrack).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();

      await expect(engine.startPerformance()).resolves.toBe(true);
      expect(store().status).toBe("break");
      expect(deps.playTrack).toHaveBeenCalledTimes(1);
    });

    it("stop during a volume ramp always leaves the shared player at volume 1", async () => {
      await engine.startPerformance();
      await advance(3000); // break over → duck ramp in progress
      await advance(250);
      await engine.stopPerformance();
      const callsAtStop = (TrackPlayer.setVolume as jest.Mock).mock.calls
        .length;
      await advance(5000); // any in-flight ramp step would land here
      const after = (TrackPlayer.setVolume as jest.Mock).mock.calls.slice(
        callsAtStop,
      );
      expect(after).toEqual([]);
      expect(lastVolume()).toBe(1);
    });

    it("stop while playTrack is pending: nothing keeps playing afterwards", async () => {
      const load = deferred<undefined>();
      deps.playTrack.mockImplementationOnce(() => load.promise);

      const started = engine.startPerformance();
      await advance(0);
      expect(deps.playTrack).toHaveBeenCalledTimes(1); // ambiance loading

      await engine.stopPerformance();
      const resets = deps.resetPlayer.mock.calls.length;
      load.resolve(undefined); // the track finishes loading AFTER Stop
      await started;
      await advance(0);

      expect(store().status).toBe("idle");
      expect(deps.resetPlayer.mock.calls.length).toBeGreaterThan(resets);
      expect(TrackPlayer.setRepeatMode).toHaveBeenLastCalledWith(0);
      expect(lastVolume()).toBe(1);
      await advance(10000);
      expect(deps.playTrack).toHaveBeenCalledTimes(1);
      expect(Tts.speak).not.toHaveBeenCalled();
    });

    it("a pause tapped while the pause music loads is not overridden", async () => {
      const load = deferred<undefined>();
      deps.playTrack.mockImplementationOnce(() => load.promise);
      const started = engine.startPerformance();
      await advance(0);
      await engine.togglePlayPause(); // ignored during the transition
      load.resolve(undefined);
      await started;
      expect(store().status).toBe("break");
      expect(deps.pause).not.toHaveBeenCalled();
    });
  });

  describe("break, announcement and dance", () => {
    it("plays looped pause music during the initial break and keeps it ducked under the announcement", async () => {
      let volumeWhenSpeaking: number | undefined;
      let playCallsWhenSpeaking = -1;
      (Tts.speak as jest.Mock).mockImplementation(() => {
        volumeWhenSpeaking = lastVolume();
        playCallsWhenSpeaking = deps.playTrack.mock.calls.length;
        return Promise.resolve();
      });

      await engine.startPerformance();

      expect(deps.playTrack).toHaveBeenCalledTimes(1);
      expect(deps.playTrack).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a1", url: "file:///cache/a1.mp3" }),
        undefined,
        true,
      );
      expect(TrackPlayer.setRepeatMode).toHaveBeenLastCalledWith(1); // Track

      // Fade-in of the pause music during the break.
      await advance(1000);
      expect(lastVolume()).toBeGreaterThan(0);

      // End of break → duck → announcement → fade out → dance track.
      await advance(2000);
      await advance(3000);

      expect(Tts.speak).toHaveBeenCalledWith(
        expect.stringMatching(/finale/i),
        expect.stringContaining("file:///cache/tts_"),
      );
      expect(volumeWhenSpeaking).toBeCloseTo(0.25);
      // The announcement did not replace the pause music on the main player.
      expect(playCallsWhenSpeaking).toBe(1);

      expect(deps.playTrack).toHaveBeenCalledTimes(2);
      expect(deps.playTrack).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "s1", url: "file:///cache/s1.mp3" }),
        undefined,
        true,
      );
      // Repeat mode never leaks into a dance.
      expect(TrackPlayer.setRepeatMode).toHaveBeenLastCalledWith(0); // Off
      expect(store().status).toBe("playing");
      expect(store().currentDanceIndex).toBe(0);
    });

    it("does not start the dance countdown before the track is actually playing", async () => {
      (TrackPlayer.getState as jest.Mock).mockResolvedValue(State.Paused);
      setProgram({ pauseDuration: 0, duration: 10 });

      await engine.startPerformance();
      await advance(2000); // announcement + fade
      expect(store().status).toBe("playing");
      expect(store().timeRemaining).toBe(10);

      await advance(3000); // still buffering
      expect(store().timeRemaining).toBe(10);

      mockStateListeners.forEach((l) => l({ state: State.Playing }));
      await advance(3000);
      expect(store().timeRemaining).toBe(7);
    });

    it("starts the countdown anyway after the playback timeout", async () => {
      (TrackPlayer.getState as jest.Mock).mockResolvedValue(State.Paused);
      setProgram({ pauseDuration: 0, duration: 30 });
      await engine.startPerformance();
      await advance(2000);
      await advance(engine.PLAYBACK_START_TIMEOUT_MS + 2000);
      expect(store().timeRemaining).toBeLessThan(30);
    });

    it("ignores play/pause while the announcement is in progress", async () => {
      let finishSpeak: () => void = () => {};
      (Tts.speak as jest.Mock).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishSpeak = resolve;
          }),
      );
      await engine.startPerformance();
      await advance(4000); // break over, announcing
      expect(store().isAnnouncing).toBe(true);

      await engine.togglePlayPause();
      expect(store().status).toBe("break");
      expect(deps.pause).not.toHaveBeenCalled();

      finishSpeak();
      await advance(2000);
      expect(store().status).toBe("playing");
      expect(store().isAnnouncing).toBe(false);
    });

    it("runs a whole programme to finished with the closing line", async () => {
      setProgram({
        rounds: [
          {
            ...createRound("Latin", "Final"),
            selectedDances: ["Samba", "Jive"],
          },
        ],
        duration: 3,
        pauseDuration: 2,
      });
      await engine.startPerformance();

      for (let i = 0; i < 30 && store().status !== "finished"; i++) {
        await advance(1000);
      }

      expect(store().status).toBe("finished");
      const spoken = (Tts.speak as jest.Mock).mock.calls.map((c) => c[0]);
      expect(spoken).toHaveLength(3);
      expect(spoken[0]).toMatch(/Samba/);
      expect(spoken[1]).toMatch(/Jive/);
      expect(spoken[2]).toBe(CLOSING_ANNOUNCEMENT);
      expect(deps.resetPlayer).toHaveBeenCalled();
    });

    it("pauses and resumes the current phase", async () => {
      await engine.startPerformance();
      await engine.togglePlayPause();
      expect(store().status).toBe("paused");
      expect(deps.pause).toHaveBeenCalled();
      const frozen = store().timeRemaining;
      await advance(3000);
      expect(store().timeRemaining).toBe(frozen);

      await engine.togglePlayPause();
      expect(store().status).toBe("break");
      expect(deps.resume).toHaveBeenCalled();
    });

    it("stops everything and cancels the announcement", async () => {
      await engine.startPerformance();
      await engine.stopPerformance();
      expect(store().status).toBe("idle");
      expect(Tts.stop).toHaveBeenCalled();
      expect(deps.resetPlayer).toHaveBeenCalled();
      await advance(10000);
      expect(Tts.speak).not.toHaveBeenCalled();
    });

    it("skips to the next dance on demand", async () => {
      await engine.startPerformance();
      const skipping = engine.nextDance();
      await advance(3000); // duck + fade ramps
      await skipping;
      expect(Tts.speak).toHaveBeenCalledTimes(1);
      expect(store().status).toBe("playing");
    });

    it("stops with an alert when the announcement fails at playback", async () => {
      (Tts.speak as jest.Mock).mockRejectedValue(new Error("TTS Dead"));
      await engine.startPerformance();
      await advance(4000);
      expect(store().status).toBe("idle");
      expect(Alert.alert).toHaveBeenCalledWith("TTS indisponible", "TTS Dead");
    });
  });
});
