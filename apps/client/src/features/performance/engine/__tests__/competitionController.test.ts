import { Alert } from "react-native";
import Tts from "../../../../services/TtsService";
import {
  OFFICIAL_DANCE_ORDER,
  useDanceOrderStore,
} from "../../../../stores/danceOrder.store";
import {
  createRound,
  usePerformanceStore,
  type Category,
  type RoundConfig,
  type RoundType,
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
    setRate: jest.fn(() => Promise.resolve()),
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
const RUMBA = t("r1", "Rumba");
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

/** Round of one category (2 groups, 1 for a Final) dancing `dances`. */
const roundOf = (
  category: Category,
  type: RoundType,
  dances: string[],
): RoundConfig => {
  const round = createRound(category, type);
  return { ...round, dances: { ...round.dances, [category]: dances } };
};

const setProgram = (patch: Partial<PerformanceConfig> = {}) => {
  store().setConfig({
    rounds: [roundOf("Latin", "Final", ["Samba"])],
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

/** Time taken by the call of the next dance at the start of a break. */
const BREAK_CALL_MS = engine.BREAK_FADE_IN_MS + engine.AMBIANCE_RISE_MS;

const spokenTexts = () =>
  (Tts.speak as jest.Mock).mock.calls.map((c) => c[0] as string);

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
    useDanceOrderStore.setState({ danceOrder: OFFICIAL_DANCE_ORDER });
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
      tracks: [SAMBA, RUMBA, JIVE],
      ambiance: [AMBIANCE],
    });
    (cacheTrack as jest.Mock).mockImplementation((track: TrackData) =>
      Promise.resolve(`file:///cache/${track.id}.mp3`),
    );
    (Tts.preload as jest.Mock).mockImplementation((text: string) =>
      Promise.resolve(`file:///cache/tts_${text.length}.mp3`),
    );
    (Tts.speak as jest.Mock).mockResolvedValue("spoken");
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
        rounds: [roundOf("Latin", "Round", ["Samba", "Jive"])],
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

    it("plays the dances in the order chosen by the user", async () => {
      useDanceOrderStore
        .getState()
        .setCategoryOrder("Latin", ["Jive", "Rumba", "Samba"]);
      setProgram({
        rounds: [roundOf("Latin", "Final", ["Samba", "Jive", "Rumba"])],
      });
      await expect(engine.startPerformance()).resolves.toBe(true);
      const list = store().playlist;
      expect(list.map((i) => i.style)).toEqual(["Jive", "Rumba", "Samba"]);
      expect(list[0].announcementText).toMatch(/Jaïve/);
    });

    it("previews the playlist in the user's order", () => {
      useDanceOrderStore
        .getState()
        .setCategoryOrder("Latin", ["Jive", "Samba"]);
      engine.setEngineDeps({ ...deps, allTracks: [SAMBA, JIVE] });
      setProgram({
        rounds: [roundOf("Latin", "Final", ["Samba", "Jive"])],
      });
      engine.generatePlaylist();
      expect(store().playlist.map((i) => i.style)).toEqual(["Jive", "Samba"]);
    });

    it("lists missing dances instead of starting", async () => {
      setProgram({
        rounds: [roundOf("Standard", "Final", ["Tango", "Quickstep"])],
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
        rounds: [roundOf("Latin", "Round", [])],
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

  describe("paso doble et réglage « 3 clashs »", () => {
    const PASO_2 = { ...t("p2", "Paso Doble"), clashTimecodes: [40, 80] };
    const PASO_3 = {
      ...t("p3", "Paso Doble"),
      clashTimecodes: [40, 80, 120],
    };
    const pasoProgram = (pasoClashes: 2 | 3) =>
      setProgram({
        // 4 Latin groups dancing only the paso doble → 4 paso items.
        rounds: [
          {
            ...roundOf("Latin", "Round", ["Paso Doble"]),
            groups: ["Latin", "Latin", "Latin", "Latin"],
          },
        ],
        pasoClashes,
      });

    it("« 3 clashs » : ne tire jamais un paso à 2 clashs, joué 120 s", async () => {
      pasoProgram(3);
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [PASO_2, PASO_3],
        ambiance: [],
      });

      await expect(engine.startPerformance()).resolves.toBe(true);

      const pasos = store().playlist;
      expect(pasos.length).toBe(4);
      expect(pasos.every((i) => i.track.id === "p3")).toBe(true);
      expect(pasos.every((i) => i.duration === 120)).toBe(true);
    });

    it("« 3 clashs » avec seulement des pasos à 2 clashs : musique manquante", async () => {
      pasoProgram(3);
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [PASO_2],
        ambiance: [],
      });

      await expect(engine.startPerformance()).resolves.toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Musiques manquantes",
        expect.stringContaining("Paso"),
      );
    });

    it("« 2 clashs » : les deux coupes sont éligibles, coupées à 80 s", async () => {
      pasoProgram(2);
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [PASO_2, PASO_3],
        ambiance: [],
      });

      await expect(engine.startPerformance()).resolves.toBe(true);

      const pasos = store().playlist;
      expect(new Set(pasos.map((i) => i.track.id))).toEqual(
        new Set(["p2", "p3"]),
      );
      expect(pasos.every((i) => i.duration === 80)).toBe(true);
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
      await advance(250); // pause music fading in under the break call
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
    it("calls the next dance at the START of the break, over ducked pause music, then holds the full preparation time", async () => {
      let volumeWhenSpeaking: number | undefined;
      let playCallsWhenSpeaking = -1;
      let remainingWhenSpeaking = -1;
      (Tts.speak as jest.Mock).mockImplementation(() => {
        volumeWhenSpeaking = lastVolume();
        playCallsWhenSpeaking = deps.playTrack.mock.calls.length;
        remainingWhenSpeaking = store().timeRemaining;
        return Promise.resolve("spoken");
      });

      await engine.startPerformance();

      expect(deps.playTrack).toHaveBeenCalledTimes(1);
      expect(deps.playTrack).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a1", url: "file:///cache/a1.mp3" }),
        undefined,
        true,
      );
      expect(TrackPlayer.setRepeatMode).toHaveBeenLastCalledWith(1); // Track

      // Start of the break: pause music fades in to the ducked level, then
      // the MC calls the first dance.
      await advance(engine.BREAK_FADE_IN_MS);
      expect(Tts.speak).toHaveBeenCalledTimes(1);
      expect(Tts.speak).toHaveBeenCalledWith(
        expect.stringMatching(/finale/i),
        expect.stringContaining("file:///cache/tts_"),
      );
      expect(volumeWhenSpeaking).toBeCloseTo(engine.DUCKED_VOLUME);
      // The announcement did not replace the pause music on the main player.
      expect(playCallsWhenSpeaking).toBe(1);
      // The countdown has not started yet.
      expect(remainingWhenSpeaking).toBe(3);

      // Pause music back up, still the whole break ahead.
      await advance(engine.AMBIANCE_RISE_MS);
      expect(lastVolume()).toBeCloseTo(engine.AMBIANCE_VOLUME);
      expect(store().status).toBe("break");
      expect(store().timeRemaining).toBe(3);
      expect(store().isAnnouncing).toBe(false);

      await advance(1000);
      expect(store().timeRemaining).toBe(2);

      // End of break → fade out → dance track, without a second announcement.
      await advance(2000);
      await advance(2000);
      expect(Tts.speak).toHaveBeenCalledTimes(1);
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

    it("holds the break countdown for as long as the MC speaks", async () => {
      let finishSpeak: () => void = () => {};
      (Tts.speak as jest.Mock).mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            finishSpeak = () => resolve("spoken");
          }),
      );
      await engine.startPerformance();
      await advance(10000); // a (very) long announcement
      expect(store().isAnnouncing).toBe(true);
      expect(store().status).toBe("break");
      expect(store().timeRemaining).toBe(3);

      finishSpeak();
      await advance(engine.AMBIANCE_RISE_MS);
      expect(store().timeRemaining).toBe(3);
      await advance(1000);
      expect(store().timeRemaining).toBe(2);
    });

    it.each(["not-played", "interrupted"])(
      "a break call that was not heard (%s) is called again right before the dance",
      async (outcome) => {
        (Tts.speak as jest.Mock)
          .mockResolvedValueOnce(outcome)
          .mockResolvedValue("spoken");
        let volumeAtRetry: number | undefined;
        let statusAtRetry = "";
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        expect(Tts.speak).toHaveBeenCalledTimes(1);
        (Tts.speak as jest.Mock).mockImplementation(() => {
          volumeAtRetry = lastVolume();
          statusAtRetry = store().status;
          return Promise.resolve("spoken");
        });

        // Break countdown (3 s), then the retry over ducked pause music.
        await advance(3000 + 1000);
        expect(Tts.speak).toHaveBeenCalledTimes(2);
        expect(spokenTexts()[1]).toBe(spokenTexts()[0]);
        expect(statusAtRetry).toBe("break");
        expect(volumeAtRetry).toBeCloseTo(engine.DUCKED_VOLUME);

        await advance(2000);
        expect(store().status).toBe("playing");
        expect(store().currentDanceIndex).toBe(0);
        expect(Tts.speak).toHaveBeenCalledTimes(2);
        expect(Alert.alert).not.toHaveBeenCalled();
      },
    );

    it("a dance announcement that was not heard never blocks the dance", async () => {
      setProgram({ pauseDuration: 0, duration: 10 });
      (Tts.speak as jest.Mock).mockResolvedValue("not-played");
      await engine.startPerformance();
      await advance(2000);
      expect(Tts.speak).toHaveBeenCalledTimes(1);
      expect(store().status).toBe("playing");
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it("without a break, speaks only once the paused music player let the audio session settle", async () => {
      setProgram({ pauseDuration: 0, duration: 10 });
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [SAMBA],
        ambiance: [],
      });
      let pausedBeforeSpeak = false;
      (Tts.speak as jest.Mock).mockImplementation(() => {
        pausedBeforeSpeak = deps.pause.mock.calls.length > 0;
        return Promise.resolve("spoken");
      });
      await engine.startPerformance();
      await advance(engine.AUDIO_SESSION_SETTLE_MS - 50);
      expect(Tts.speak).not.toHaveBeenCalled();
      await advance(100);
      expect(Tts.speak).toHaveBeenCalledTimes(1);
      expect(pausedBeforeSpeak).toBe(true);
    });

    it("calls the next dance at the start of each break, never again before the dance", async () => {
      setProgram({
        rounds: [roundOf("Latin", "Final", ["Samba", "Jive"])],
        duration: 3,
        pauseDuration: 4,
      });
      const atSpeak: { remaining: number; status: string }[] = [];
      (Tts.speak as jest.Mock).mockImplementation(() => {
        atSpeak.push({
          remaining: store().timeRemaining,
          status: store().status,
        });
        return Promise.resolve("spoken");
      });
      await engine.startPerformance();
      await advance(BREAK_CALL_MS + 4000 + 2000); // break 1 → Samba playing
      expect(store().status).toBe("playing");
      expect(spokenTexts()).toHaveLength(1);

      await advance(3000); // Samba over → break 2 starts
      expect(store().status).toBe("break");
      await advance(BREAK_CALL_MS);
      expect(spokenTexts()).toHaveLength(2);
      expect(spokenTexts()[1]).toMatch(/Jaïve/);
      expect(store().currentDanceIndex).toBe(0);
      // Both calls made at the very start of their break, full time ahead.
      expect(atSpeak).toEqual([
        { remaining: 4, status: "break" },
        { remaining: 4, status: "break" },
      ]);

      await advance(4000 + 2000); // break 2 over → Jive, no new announcement
      expect(store().status).toBe("playing");
      expect(store().currentDanceIndex).toBe(1);
      expect(spokenTexts()).toHaveLength(2);
    });

    it("without a break, announces right before each dance (no pause music)", async () => {
      setProgram({
        rounds: [roundOf("Latin", "Final", ["Samba", "Jive"])],
        duration: 3,
        pauseDuration: 0,
      });
      await engine.startPerformance();
      await advance(2000);
      expect(spokenTexts()).toHaveLength(1);
      expect(store().status).toBe("playing");
      expect(store().currentDanceIndex).toBe(0);

      await advance(3000 + 2000);
      expect(spokenTexts()).toHaveLength(2);
      expect(spokenTexts()[1]).toMatch(/Jaïve/);
      expect(store().currentDanceIndex).toBe(1);
      // Pause music never played: only the two dance tracks.
      expect(deps.playTrack.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
        [
          expect.objectContaining({ id: "s1" }),
          expect.objectContaining({ id: "j1" }),
        ],
      );
    });

    it("calls the first dance over silence when there is no pause music", async () => {
      (loadCompetitionLibrary as jest.Mock).mockResolvedValue({
        tracks: [SAMBA],
        ambiance: [],
      });
      await engine.startPerformance();
      await advance(0);
      // The music player was just paused: the voice waits for the audio
      // session to settle (expo-audio deactivates it 100 ms after a pause).
      expect(deps.pause).toHaveBeenCalled();
      expect(spokenTexts()).toHaveLength(0);
      await advance(engine.AUDIO_SESSION_SETTLE_MS);
      expect(spokenTexts()).toHaveLength(1);
      expect(store().timeRemaining).toBe(3);
      await advance(3000 + 1000);
      expect(store().status).toBe("playing");
      expect(spokenTexts()).toHaveLength(1);
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
          new Promise<string>((resolve) => {
            finishSpeak = () => resolve("spoken");
          }),
      );
      await engine.startPerformance();
      await advance(engine.BREAK_FADE_IN_MS); // start of break, announcing
      expect(store().isAnnouncing).toBe(true);

      await engine.togglePlayPause();
      expect(store().status).toBe("break");
      expect(deps.pause).not.toHaveBeenCalled();

      finishSpeak();
      await advance(BREAK_CALL_MS);
      expect(store().isAnnouncing).toBe(false);
      expect(store().status).toBe("break");
      await advance(3000 + 2000);
      expect(store().status).toBe("playing");
    });

    it("runs a whole programme to finished with the closing line", async () => {
      setProgram({
        rounds: [roundOf("Latin", "Final", ["Samba", "Jive"])],
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
      expect(spoken[1]).toMatch(/Jaïve/);
      expect(spoken[2]).toBe(CLOSING_ANNOUNCEMENT);
      expect(deps.resetPlayer).toHaveBeenCalled();
    });

    it("pauses and resumes the current phase", async () => {
      await engine.startPerformance();
      await advance(BREAK_CALL_MS);
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

    describe("⏭ next step", () => {
      beforeEach(() => {
        setProgram({
          rounds: [roundOf("Latin", "Final", ["Samba", "Jive"])],
          duration: 20,
          pauseDuration: 10,
        });
      });

      it("from the get-ready break: first dance starts without a second announcement", async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        expect(Tts.speak).toHaveBeenCalledTimes(1);
        const step = engine.nextStep();
        await advance(3000);
        await step;
        expect(Tts.speak).toHaveBeenCalledTimes(1);
        expect(store().status).toBe("playing");
        expect(store().currentDanceIndex).toBe(0);
      });

      it("is ignored while the break call is spoken (never cut, never replayed)", async () => {
        let finishSpeak: () => void = () => {};
        (Tts.speak as jest.Mock).mockImplementation(
          () =>
            new Promise<string>((resolve) => {
              finishSpeak = () => resolve("spoken");
            }),
        );
        await engine.startPerformance();
        await advance(engine.BREAK_FADE_IN_MS);
        expect(store().isAnnouncing).toBe(true);
        await engine.nextStep();
        await advance(3000);
        expect(Tts.stop).not.toHaveBeenCalled();
        expect(store().status).toBe("break");
        expect(Tts.speak).toHaveBeenCalledTimes(1);

        finishSpeak();
        await advance(BREAK_CALL_MS);
        const step = engine.nextStep();
        await advance(3000);
        await step;
        expect(Tts.speak).toHaveBeenCalledTimes(1);
        expect(store().status).toBe("playing");
      });

      it("during a dance: fades it out, starts the pause and calls the next dance", async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        const step = engine.nextStep();
        await advance(500);
        expect(store().status).toBe("playing"); // still fading
        await advance(1000);
        await step;
        expect(store().status).toBe("break");
        expect(store().currentDanceIndex).toBe(0);
        await advance(BREAK_CALL_MS);
        expect(Tts.speak).toHaveBeenCalledTimes(2);
        expect(spokenTexts()[1]).toMatch(/Jaïve/);
        // The whole break is still ahead once the call is over.
        expect(store().timeRemaining).toBe(10);
      });

      it("during the pause: next dance, already announced", async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        const toBreak = engine.nextStep();
        await advance(1500);
        await toBreak;
        await advance(BREAK_CALL_MS);
        const toDance = engine.nextStep();
        await advance(3000);
        await toDance;
        expect(Tts.speak).toHaveBeenCalledTimes(2);
        expect(store().status).toBe("playing");
        expect(store().currentDanceIndex).toBe(1);
      });

      it("from pause (paused dance): goes to the break", async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        await engine.togglePlayPause();
        expect(store().status).toBe("paused");
        const step = engine.nextStep();
        await advance(1500);
        await step;
        expect(store().status).toBe("break");
      });

      it("after the last dance: finishes", async () => {
        setProgram({
          rounds: [roundOf("Latin", "Final", ["Samba"])],
          duration: 20,
          pauseDuration: 10,
        });
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        const step = engine.nextStep();
        await advance(4000);
        await step;
        expect(store().status).toBe("finished");
      });
    });

    it("resets the tempo to 1x before every competition track", async () => {
      await engine.startPerformance();
      await advance(BREAK_CALL_MS);
      const skipping = engine.nextStep();
      await advance(3000);
      await skipping;
      const rateOrder = (TrackPlayer.setRate as jest.Mock).mock
        .invocationCallOrder;
      const playOrder = deps.playTrack.mock.invocationCallOrder;
      expect(TrackPlayer.setRate).toHaveBeenCalledWith(1);
      // One reset per track (pause music + dance), each before its playTrack.
      expect(rateOrder).toHaveLength(playOrder.length);
      rateOrder.forEach((order, i) => expect(order).toBeLessThan(playOrder[i]));
    });

    it("ignores ⏭ / ⏮ before the competition started", async () => {
      await engine.nextStep();
      engine.previousStep();
      await advance(2000);
      expect(Tts.speak).not.toHaveBeenCalled();
      expect(store().status).toBe("idle");
    });

    it("⏮ does nothing during the initial get-ready break", async () => {
      await engine.startPerformance();
      await advance(BREAK_CALL_MS);
      engine.previousStep();
      await advance(2000);
      expect(Tts.speak).toHaveBeenCalledTimes(1); // the break call only
      expect(store().status).toBe("break");
    });

    describe("⏭ / ⏮ in a multi-group Final (group-major)", () => {
      beforeEach(() => {
        setProgram({
          rounds: [
            {
              ...roundOf("Latin", "Final", ["Samba", "Jive"]),
              groups: ["Latin", "Latin"],
            },
          ],
          duration: 20,
          pauseDuration: 2,
        });
      });

      const current = () => {
        const item = store().playlist[store().currentDanceIndex];
        return `${item.style}:G${item.groupIndex}`;
      };
      /** From the current dance: fade → pause → announcement → next dance. */
      const toNextDance = async () => {
        const toBreak = engine.nextStep();
        await advance(1500);
        await toBreak;
        await advance(BREAK_CALL_MS);
        const toDance = engine.nextStep();
        await advance(3000);
        await toDance;
      };

      it("⏭ goes through all the dances of a group before the next group", async () => {
        await engine.startPerformance();
        expect(
          store().playlist.map((i) => `${i.style}:G${i.groupIndex}`),
        ).toEqual(["Samba:G1", "Jive:G1", "Samba:G2", "Jive:G2"]);
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        expect(current()).toBe("Samba:G1");
        await toNextDance();
        expect(current()).toBe("Jive:G1");
        await toNextDance();
        expect(current()).toBe("Samba:G2");
        const spoken = (Tts.speak as jest.Mock).mock.calls.map((c) => c[0]);
        expect(spoken[spoken.length - 1]).toMatch(/deuxième groupe/i);
      });

      it("a double ⏮ from the next group's first dance goes back to the previous group's last dance", async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const first = engine.nextStep();
        await advance(3000);
        await first;
        await toNextDance();
        await toNextDance();
        expect(current()).toBe("Samba:G2");
        engine.previousStep();
        await advance(200);
        engine.previousStep();
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(current()).toBe("Jive:G1");
      });
    });

    describe("⏮ restart / previous", () => {
      beforeEach(() => {
        setProgram({
          rounds: [roundOf("Latin", "Final", ["Samba", "Rumba", "Jive"])],
          duration: 20,
          pauseDuration: 2,
        });
      });

      /** From the get-ready break, plays dance 0 then dance 1. */
      const reachSecondDance = async () => {
        await engine.startPerformance();
        await advance(BREAK_CALL_MS);
        const a = engine.nextStep();
        await advance(3000);
        await a;
        const toBreak = engine.nextStep();
        await advance(1500);
        await toBreak;
        await advance(BREAK_CALL_MS);
        const b = engine.nextStep();
        await advance(3000);
        await b;
        expect(store().currentDanceIndex).toBe(1);
      };
      const lastSpoken = () => {
        const spoken = (Tts.speak as jest.Mock).mock.calls.map((c) => c[0]);
        return spoken[spoken.length - 1] as string;
      };

      it("one tap restarts the current dance from the top, announcement included", async () => {
        await reachSecondDance();
        await advance(8000);
        const before = (Tts.speak as jest.Mock).mock.calls.length;
        engine.previousStep();
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(store().currentDanceIndex).toBe(1);
        expect(store().status).toBe("playing");
        expect(store().timeRemaining).toBeGreaterThan(15);
        expect(Tts.speak).toHaveBeenCalledTimes(before + 1);
        expect(lastSpoken()).toMatch(/Rumba/);
      });

      it("a double tap goes back to the previous dance", async () => {
        await reachSecondDance();
        engine.previousStep();
        await advance(200);
        engine.previousStep();
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(store().currentDanceIndex).toBe(0);
        expect(lastSpoken()).toMatch(/Samba/);
      });

      it("one tap during the break replays the dance that just ended", async () => {
        await reachSecondDance();
        const toBreak = engine.nextStep();
        await advance(1500);
        await toBreak;
        await advance(BREAK_CALL_MS);
        expect(store().status).toBe("break");
        expect(lastSpoken()).toMatch(/Jaïve/); // next dance called
        engine.previousStep();
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(store().currentDanceIndex).toBe(1);
        expect(store().status).toBe("playing");
        // Replayed right away, so announced right before the dance.
        expect(lastSpoken()).toMatch(/Rumba/);

        // At its end, the following break calls the next dance again.
        const toNextBreak = engine.nextStep();
        await advance(engine.SKIP_FADE_MS);
        await toNextBreak;
        await advance(BREAK_CALL_MS);
        expect(store().status).toBe("break");
        expect(lastSpoken()).toMatch(/Jaïve/);
      });

      it("works from pause and resumes playing", async () => {
        await reachSecondDance();
        await engine.togglePlayPause();
        expect(store().status).toBe("paused");
        engine.previousStep();
        engine.previousStep();
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(store().currentDanceIndex).toBe(0);
        expect(store().status).toBe("playing");
      });

      it("a stop cancels a pending ⏮", async () => {
        await reachSecondDance();
        engine.previousStep();
        await engine.stopPerformance();
        const calls = (Tts.speak as jest.Mock).mock.calls.length;
        await advance(engine.DOUBLE_TAP_MS + 3000);
        expect(Tts.speak).toHaveBeenCalledTimes(calls);
        expect(store().status).toBe("idle");
      });
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
