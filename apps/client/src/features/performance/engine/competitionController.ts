/**
 * Competition engine (« Mode Compétition ») — module singleton.
 *
 * All the session state that must survive re-renders and be shared between
 * the screens (session token, transition flags, pause music, the 1 s timer)
 * lives here, and the observable state lives in the Zustand performance
 * store. The React hook (usePerformanceEngine) is only a binding: mounting it
 * in several components can no longer start several timers.
 *
 * Sequence of a session:
 *   loading  — fetch the full catalogue + ambiance, build the playlist, then
 *              download EVERY track, the pause music and every announcement
 *              to the local cache (progress in store.loadingProgress).
 *   break    — the MC calls the NEXT dance at the very start of the break:
 *              pause music (looped) fades in under the voice, announcement
 *              fully spoken (dedicated player, full volume), pause music
 *              back up. The countdown is held meanwhile, so dancers always
 *              get the full `pauseDuration` of preparation AFTER hearing which
 *              dance comes next (as on a real competition floor).
 *   transition (status unchanged, timer held):
 *              end of break → fade the pause music out → dance track (no
 *              second announcement). Without a break (`pauseDuration <= 0`)
 *              or on ⏮ the announcement is spoken right before the dance.
 *   playing  — the countdown only starts once the track is really playing.
 *   … repeat, then an optional closing line and status "finished".
 */
import { Alert } from "react-native";
import Tts from "../../../services/TtsService";
import {
  usePerformanceStore,
  type PlaylistItem,
} from "../../../stores/performance.store";
import { createLogger } from "../../../utils/logger";
import TrackPlayer, {
  Event,
  RepeatMode,
  State,
} from "../../../utils/TrackPlayerWrapper";
import type { TrackData } from "../../player/context/PlayerContext";
import type { TrackRepository } from "../../player/services/TrackRepository";
import {
  cacheTrack,
  runWithProgress,
  TrackDownloadError,
} from "../services/competitionAudioCache";
import { loadCompetitionLibrary } from "../services/competitionLibrary";
import { capPasoClashes, selectPasoPool } from "../utils/pasoClashCap";
import {
  buildPlaylist,
  CLOSING_ANNOUNCEMENT,
  describeValidation,
  validateProgram,
} from "../utils/competitionProgram";

const logger = createLogger("competitionController");

/** Pause music level once faded in. */
export const AMBIANCE_VOLUME = 0.7;
/** Pause music level under the announcement. */
export const DUCKED_VOLUME = 0.25;
/** Fade-in of the pause music (to the ducked level) before the break call. */
export const BREAK_FADE_IN_MS = 1000;
/** Rise of the pause music back to its normal level after the break call. */
export const AMBIANCE_RISE_MS = 1500;
/** Max wait for the dance track to report Playing before starting anyway. */
export const PLAYBACK_START_TIMEOUT_MS = 8000;
const DANCE_FADE_OUT_S = 5;
const FADE_STEP_MS = 100;
const DOWNLOAD_CONCURRENCY = 3;

const TTS_UNAVAILABLE_MESSAGE =
  "Les annonces sont indispensables pour le mode compétition. Vérifiez la connexion au serveur TTS.";

export interface EngineDeps {
  playTrack: (
    track: TrackData,
    playlist?: TrackData[],
    forceRestart?: boolean,
  ) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  resetPlayer: () => Promise<void>;
  ensurePlayerReady?: () => Promise<boolean>;
  allTracks: TrackData[];
  trackRepo: Pick<
    TrackRepository,
    "getTracksPage" | "getTrackUrl" | "getArtworkUrl"
  > | null;
}

// --- Singleton session state -------------------------------------------------

let deps: EngineDeps | null = null;
let session = 0;
let transitioning = false;
/** When true the countdown does not decrement (announcement, track start). */
let holdTimer = false;
let ambianceTrack: TrackData | null = null;
let closingPath: string | null = null;
let previousStatus: "playing" | "break" | null = null;
let ttsFailureHandled = false;
/**
 * Playlist index already announced at the start of the current break: the
 * dance that follows starts directly, without a second announcement.
 */
let announcedIndex: number | null = null;
let volume = 1;
let interval: ReturnType<typeof setInterval> | null = null;
/** Serialises calls to playTrack so a stale call can never land after a newer one. */
let playChain: Promise<unknown> = Promise.resolve();

const store = () => usePerformanceStore.getState();
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const setEngineDeps = (next: EngineDeps): void => {
  deps = next;
};

const requireDeps = (): EngineDeps => {
  if (!deps) throw new Error("Competition engine used before initialisation");
  return deps;
};

/** Test helper: forget every piece of session state. */
export const resetEngineForTests = (): void => {
  stopTimer();
  clearBackTaps();
  deps = null;
  session = 0;
  transitioning = false;
  holdTimer = false;
  ambianceTrack = null;
  closingPath = null;
  previousStatus = null;
  ttsFailureHandled = false;
  announcedIndex = null;
  volume = 1;
  playChain = Promise.resolve();
};

export const isTransitioning = (): boolean => transitioning;

// --- Audio helpers -----------------------------------------------------------

const alive = (token: number) => token === session;

/**
 * Session-scoped volume write: a no-op once the session is stale, so a fade
 * step still in flight can never land after stopPerformance restored 1 on the
 * SHARED music player (which the library keeps using afterwards).
 */
const setVolume = async (v: number, token: number): Promise<void> => {
  if (!alive(token)) return;
  volume = Math.max(0, Math.min(1, v));
  await TrackPlayer.setVolume(volume);
};

/** Unconditional restore of the shared player (stop / finish). */
const restoreVolume = async (): Promise<void> => {
  volume = 1;
  await TrackPlayer.setVolume(1);
};

const rampVolume = async (
  to: number,
  durationMs: number,
  token: number,
): Promise<void> => {
  const from = volume;
  const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  for (let i = 1; i <= steps; i++) {
    if (!alive(token)) return;
    await sleep(FADE_STEP_MS);
    // Re-checked AFTER the sleep (inside setVolume): Stop may have run meanwhile.
    await setVolume(from + ((to - from) * i) / steps, token);
  }
};

/**
 * Plays a track on the shared player for session `token`. Calls are
 * serialised; a call whose session is already stale is skipped, and a call
 * that completes after Stop is undone (nothing keeps playing on the idle
 * screen). Resolves true when the session is still alive.
 */
const playOnMain = (track: TrackData, token: number): Promise<boolean> => {
  const run = playChain.then(async () => {
    if (!alive(token)) return false;
    const d = requireDeps();
    // The shared player keeps the last tempo set in the library (and re-applies
    // it to every new track): a competition always plays at the original tempo.
    await TrackPlayer.setRate(1);
    await d.playTrack(track, undefined, true);
    if (alive(token)) return true;
    // Stopped while the track was loading: undo it.
    await d.resetPlayer().catch(() => {});
    const status = store().status;
    if (status === "idle" || status === "finished") {
      await TrackPlayer.setRepeatMode(RepeatMode.Off).catch(() => {});
      await restoreVolume().catch(() => {});
    }
    return false;
  });
  playChain = run.catch(() => false);
  return run;
};

/**
 * Resolves true on the first Playing state of the freshly loaded track,
 * false after `timeoutMs` (we then start the countdown anyway).
 */
const waitForPlayback = (timeoutMs: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.remove();
      resolve(ok);
    };
    const sub = TrackPlayer.addEventListener(
      Event.PlaybackState,
      (data: { state: State }) => {
        if (data.state === State.Playing) finish(true);
      },
    );
    const timer = setTimeout(() => {
      logger.warn("Dance track did not report Playing in time");
      finish(false);
    }, timeoutMs);
    TrackPlayer.getState()
      .then((s) => {
        if (s === State.Playing) finish(true);
      })
      .catch(() => {});
  });

// --- Timer -------------------------------------------------------------------

function stopTimer(): void {
  if (interval) clearInterval(interval);
  interval = null;
}

function startTimer(): void {
  stopTimer();
  interval = setInterval(tick, 1000);
}

/** One second of the countdown (fades + completion). Exported for tests. */
export function tick(): void {
  const s = store();
  const token = session;
  if (holdTimer || transitioning) return;
  if (s.status !== "playing" && s.status !== "break") return;

  const prev = s.timeRemaining;
  const next = Math.max(0, prev - 1);
  s.setTimeRemaining(next);

  if (s.status === "playing" && next < DANCE_FADE_OUT_S) {
    // Dance fade-out over the last seconds.
    setVolume(next / DANCE_FADE_OUT_S, token).catch(() => {});
  }

  if (next === 0) handleTimerComplete();
}

function handleTimerComplete(): void {
  if (transitioning || holdTimer) return;
  const s = store();
  const nextIndex = s.currentDanceIndex + 1;
  const hasNext = nextIndex < s.playlist.length;

  if (s.status === "playing") {
    if (!hasNext) {
      finishPerformance().catch((e) => logger.warn("Finish failed", e));
    } else if (s.config.pauseDuration > 0) {
      startBreak().catch((e) => logger.warn("Break failed", e));
    } else {
      transitionToDance(nextIndex, true).catch((e) =>
        logger.warn("Transition failed", e),
      );
    }
  } else if (s.status === "break") {
    if (hasNext) {
      // Already called at the start of the break → straight into the dance.
      const announce = announcedIndex !== nextIndex;
      transitionToDance(nextIndex, announce).catch((e) =>
        logger.warn("Transition failed", e),
      );
    } else {
      finishPerformance().catch((e) => logger.warn("Finish failed", e));
    }
  }
}

// --- Phases ------------------------------------------------------------------

async function playAmbiance(token: number): Promise<void> {
  const d = requireDeps();
  if (!ambianceTrack) {
    await d.pause();
    return;
  }
  await setVolume(0, token);
  if (!(await playOnMain(ambianceTrack, token))) return;
  // Loop the pause music for the whole break, whatever the user's repeat mode.
  await TrackPlayer.setRepeatMode(RepeatMode.Track);
}

/**
 * Starts a break (or the initial "get ready" one). Resolves once the pause
 * music is loaded; the call of the next dance then runs on its own (see
 * announceBreak) so the setup screen is not kept waiting for it.
 */
async function startBreak(): Promise<void> {
  const token = session;
  const s = store();
  const pauseDuration = s.config.pauseDuration;
  const nextIndex = s.currentDanceIndex + 1;
  s.setStatus("break");
  s.setActivePhase("break");
  s.setTimeRemaining(pauseDuration);
  announcedIndex = null;
  // While the pause music loads, a play/pause tap must not be overridden by
  // the track starting afterwards → treat it as a transition.
  transitioning = true;
  holdTimer = true;
  let announcing = false;
  try {
    if (pauseDuration > 0) {
      await playAmbiance(token);
      if (alive(token)) {
        // Keeps transitioning/holdTimer until the call is over.
        announcing = true;
        announceBreak(nextIndex, token).catch((e) =>
          logger.warn("Break announcement failed", e),
        );
      }
    } else {
      await requireDeps().pause();
    }
  } finally {
    if (alive(token) && !announcing) {
      transitioning = false;
      holdTimer = false;
    }
  }
  // No break: go straight to the announcement of the next dance.
  if (alive(token) && pauseDuration <= 0) handleTimerComplete();
}

/**
 * Start of a break: the MC calls the next dance over the ducked pause music,
 * then the music comes back up and only then does the countdown run — the
 * whole break is left to the dancers to get ready.
 */
async function announceBreak(index: number, token: number): Promise<void> {
  const item = store().playlist[index] as PlaylistItem | undefined;
  try {
    if (item) {
      store().setIsAnnouncing(true);
      if (ambianceTrack)
        await rampVolume(DUCKED_VOLUME, BREAK_FADE_IN_MS, token);
      if (!alive(token)) return;
      try {
        await Tts.speak(item.announcementText, item.announcementPath);
      } catch (e) {
        logger.warn("TTS Speak Error", e);
        await handleTtsFailure(e instanceof Error ? e.message : undefined);
        return;
      }
      if (!alive(token)) return;
      announcedIndex = index;
      store().setIsAnnouncing(false);
    }
    if (ambianceTrack)
      await rampVolume(AMBIANCE_VOLUME, AMBIANCE_RISE_MS, token);
  } finally {
    if (alive(token)) {
      transitioning = false;
      holdTimer = false;
      store().setIsAnnouncing(false);
    }
  }
}

async function playDance(index: number, token: number): Promise<void> {
  if (!alive(token)) return;
  const item = store().playlist[index] as PlaylistItem | undefined;
  if (!item) return;
  const s = store();
  holdTimer = true;
  s.setCurrentDanceIndex(index);
  s.setStatus("playing");
  s.setActivePhase("dance");
  s.setTimeRemaining(item.duration);
  await setVolume(1, token);
  if (!(await playOnMain(item.track, token))) return;
  // Never let the user's repeat mode (player.loop) leak into a dance.
  await TrackPlayer.setRepeatMode(RepeatMode.Off);
  await waitForPlayback(PLAYBACK_START_TIMEOUT_MS);
  if (!alive(token)) return;
  holdTimer = false;
}

/**
 * Break (or end of dance) → [announcement] → dance. The announcement is
 * skipped when it was already made at the start of the break. Nothing else
 * may touch the audio meanwhile: the timer is held and play/pause presses are
 * ignored.
 */
async function transitionToDance(
  index: number,
  announce: boolean,
): Promise<void> {
  if (transitioning) return;
  const item = store().playlist[index] as PlaylistItem | undefined;
  if (!item) {
    await finishPerformance();
    return;
  }
  const token = session;
  transitioning = true;
  holdTimer = true;
  try {
    const fromBreak = store().status === "break" && ambianceTrack !== null;
    if (announce) {
      store().setIsAnnouncing(true);
      if (fromBreak) {
        await rampVolume(DUCKED_VOLUME, 600, token);
      } else {
        await requireDeps().pause();
      }
      if (!alive(token)) return;

      try {
        await Tts.speak(item.announcementText, item.announcementPath);
      } catch (e) {
        logger.warn("TTS Speak Error", e);
        await handleTtsFailure(e instanceof Error ? e.message : undefined);
        return;
      }
      if (!alive(token)) return;
      store().setIsAnnouncing(false);
    }

    if (fromBreak) await rampVolume(0, 1000, token);
    if (!alive(token)) return;
    await playDance(index, token);
  } finally {
    if (alive(token)) {
      transitioning = false;
      store().setIsAnnouncing(false);
    }
  }
}

async function finishPerformance(): Promise<void> {
  const token = session;
  const d = requireDeps();
  transitioning = true;
  holdTimer = true;
  try {
    await rampVolume(0, 800, token);
    await d.pause();
    if (!alive(token)) return;
    if (closingPath) {
      try {
        await Tts.speak(CLOSING_ANNOUNCEMENT, closingPath);
      } catch (e) {
        logger.warn("Closing announcement failed", e);
      }
    }
    if (!alive(token)) return;
    stopTimer();
    store().setStatus("finished");
    store().setTimeRemaining(0);
    await d.resetPlayer();
    await TrackPlayer.setRepeatMode(RepeatMode.Off).catch(() => {});
    await restoreVolume();
  } finally {
    if (alive(token)) {
      transitioning = false;
      holdTimer = false;
    }
  }
}

async function handleTtsFailure(message?: string): Promise<void> {
  if (ttsFailureHandled) return;
  ttsFailureHandled = true;
  await stopPerformance();
  Alert.alert("TTS indisponible", message ?? TTS_UNAVAILABLE_MESSAGE);
}

// --- Public API ----------------------------------------------------------------

export async function stopPerformance(): Promise<void> {
  session += 1;
  clearBackTaps();
  transitioning = false;
  holdTimer = false;
  previousStatus = null;
  announcedIndex = null;
  stopTimer();
  const s = store();
  s.setStatus("idle");
  s.setLoadingProgress(null);
  s.setIsAnnouncing(false);
  await Tts.stop().catch(() => {});
  if (deps) await deps.resetPlayer().catch(() => {});
  await TrackPlayer.setRepeatMode(RepeatMode.Off).catch(() => {});
  // Always last: any in-flight fade step is a no-op now (stale token).
  await restoreVolume();
}

class MissingAnnouncementError extends Error {}

/**
 * Prepares everything (catalogue, playlist, downloads) then starts the
 * initial "get ready" break. Resolves false (with a French Alert) when the
 * competition cannot start — never starts a half-loaded competition.
 */
export async function startPerformance(): Promise<boolean> {
  const d = requireDeps();
  // Double start (double tap, or a session already running) is refused.
  const current = store().status;
  if (current !== "idle" && current !== "finished") return false;
  session += 1;
  const token = session;
  stopTimer();
  transitioning = false;
  holdTimer = false;
  ttsFailureHandled = false;
  ambianceTrack = null;
  closingPath = null;
  previousStatus = null;
  announcedIndex = null;

  const s = store();
  s.setStatus("loading");
  s.setLoadingProgress({ done: 0, total: 0 });

  const abort = async (title: string, message: string) => {
    if (!alive(token)) return false;
    await stopPerformance();
    Alert.alert(title, message);
    return false;
  };

  try {
    const library = await loadCompetitionLibrary(d.trackRepo, d.allTracks);
    if (!alive(token)) return false;

    const cfg = store().config;
    // Paso doble : réglage « 3 clashs » → seules les pistes à 3 clashs.
    const pool = selectPasoPool(library.tracks, cfg.pasoClashes);
    const validation = validateProgram(cfg, pool);
    const problem = describeValidation(validation);
    if (problem) {
      return await abort(
        validation.emptyRounds.length > 0
          ? "Programme incomplet"
          : "Musiques manquantes",
        problem,
      );
    }

    // Paso doble : joué jusqu'au clash choisi, jamais au-delà de ceux de la piste.
    const list = capPasoClashes(buildPlaylist(cfg, pool), cfg);
    if (list.length === 0) {
      return await abort(
        "Erreur",
        "Aucune musique trouvée pour les danses sélectionnées.",
      );
    }

    const ambiance =
      library.ambiance.length > 0
        ? library.ambiance[Math.floor(Math.random() * library.ambiance.length)]
        : null;

    await d.ensurePlayerReady?.();

    // --- Download everything before starting --------------------------------
    const uniqueTracks = [
      ...new Map(list.map((i) => [i.track.id, i.track])).values(),
    ];
    const texts = [...new Set(list.map((i) => i.announcementText))];
    const trackUris = new Map<string, string>();
    const ttsPaths = new Map<string, string>();
    // Holder object: assigned inside a task closure.
    const ambianceCache: { uri: string | null } = { uri: null };

    const tasks: (() => Promise<void>)[] = [
      ...uniqueTracks.map((t) => async () => {
        trackUris.set(t.id, await cacheTrack(t));
      }),
      ...texts.map((text) => async () => {
        const path = await Tts.preload(text);
        if (!path) throw new MissingAnnouncementError();
        ttsPaths.set(text, path);
      }),
    ];
    if (ambiance) {
      tasks.push(async () => {
        try {
          ambianceCache.uri = await cacheTrack(ambiance);
        } catch (e) {
          // Pause music is a comfort, not a requirement: silent breaks.
          logger.warn("Ambiance download failed (silent breaks)", e);
        }
      });
    }
    tasks.push(async () => {
      try {
        closingPath = await Tts.preload(CLOSING_ANNOUNCEMENT);
      } catch {
        closingPath = null; // optional closing line
      }
    });

    try {
      await runWithProgress(
        tasks,
        (done, total) => {
          if (alive(token)) store().setLoadingProgress({ done, total });
        },
        DOWNLOAD_CONCURRENCY,
        // Cancelled (Stop / Annuler): stop starting new downloads.
        () => alive(token),
      );
    } catch (e) {
      if (!alive(token)) return false;
      if (e instanceof TrackDownloadError) {
        return await abort(
          "Chargement impossible",
          `Impossible de télécharger « ${e.track.title} ». Vérifiez votre connexion puis réessayez.`,
        );
      }
      logger.warn("[Performance] TTS preload failed", e);
      await handleTtsFailure(
        e instanceof MissingAnnouncementError || !(e instanceof Error)
          ? undefined
          : e.message,
      );
      return false;
    }
    if (!alive(token)) return false;

    const ready: PlaylistItem[] = list.map((item) => ({
      ...item,
      track: { ...item.track, url: trackUris.get(item.track.id) ?? "" },
      announcementPath: ttsPaths.get(item.announcementText),
    }));
    ambianceTrack =
      ambiance && ambianceCache.uri
        ? { ...ambiance, url: ambianceCache.uri }
        : null;

    s.setPlaylist(ready);
    s.setCurrentDanceIndex(-1);
    s.setLoadingProgress(null);
    startTimer();
    await startBreak();
    return true;
  } catch (error) {
    logger.warn("[Performance] start failed", error);
    return abort(
      "Erreur",
      "Impossible de préparer la compétition. Vérifiez votre connexion puis réessayez.",
    );
  }
}

export async function togglePlayPause(): Promise<void> {
  // An announcement / track start is in progress: ignore (it would cut it).
  if (transitioning) return;
  const d = requireDeps();
  const s = store();
  if (s.status === "playing" || s.status === "break") {
    previousStatus = s.status;
    s.setStatus("paused");
    await d.pause();
  } else if (s.status === "paused") {
    s.setStatus(previousStatus ?? "playing");
    await d.resume();
  } else if (s.status === "idle") {
    await startPerformance();
  }
}

/** Fade applied when ⏭ cuts a dance short. */
export const SKIP_FADE_MS = 1000;
/** A second ⏮ within this delay means « previous dance ». */
export const DOUBLE_TAP_MS = 600;

/** Phase the session is in, looking through a pause. */
const currentPhase = (): "playing" | "break" | null => {
  const s = store();
  const status = s.status === "paused" ? previousStatus : s.status;
  return status === "playing" || status === "break" ? status : null;
};

/**
 * ⏭ — moves to the next step of the normal flow, skipping nothing:
 * dance → (short fade) → pause with the call of the next dance → next dance.
 */
export async function nextStep(): Promise<void> {
  if (transitioning) return;
  const phase = currentPhase();
  if (!phase) return;
  const s = store();
  if (s.status === "paused") {
    s.setStatus(phase);
    previousStatus = null;
  }
  if (phase === "playing") {
    const token = session;
    transitioning = true;
    holdTimer = true;
    try {
      await rampVolume(0, SKIP_FADE_MS, token);
    } finally {
      if (alive(token)) {
        transitioning = false;
        holdTimer = false;
      }
    }
    if (!alive(token)) return;
  }
  handleTimerComplete();
}

let backTaps = 0;
let backTimer: ReturnType<typeof setTimeout> | null = null;

const clearBackTaps = (): void => {
  if (backTimer) clearTimeout(backTimer);
  backTimer = null;
  backTaps = 0;
};

/**
 * ⏮ — one tap restarts the current dance from the beginning (announcement
 * included; during a pause, the dance that just ended). A double tap goes
 * back to the previous dance. Taps are collected for DOUBLE_TAP_MS first.
 */
export function previousStep(): void {
  if (transitioning || store().currentDanceIndex < 0 || !currentPhase()) {
    return;
  }
  backTaps += 1;
  if (backTimer) return;
  backTimer = setTimeout(() => {
    const twice = backTaps >= 2;
    clearBackTaps();
    goBack(twice).catch((e) => logger.warn("Previous failed", e));
  }, DOUBLE_TAP_MS);
}

async function goBack(twice: boolean): Promise<void> {
  if (transitioning || !currentPhase()) return;
  const current = store().currentDanceIndex;
  if (current < 0) return;
  previousStatus = null;
  // No break in between: the dance is announced right before it restarts.
  await transitionToDance(twice ? Math.max(0, current - 1) : current, true);
}

/** Ends the current phase now (with its normal transition). */
export function fadeNow(): void {
  handleTimerComplete();
}

/** Recomputes a preview playlist from the current config (no audio). */
export function generatePlaylist(): void {
  const d = requireDeps();
  const s = store();
  const pool = selectPasoPool(d.allTracks, s.config.pasoClashes);
  s.setPlaylist(capPasoClashes(buildPlaylist(s.config, pool), s.config));
  s.setCurrentDanceIndex(0);
  s.setStatus("idle");
}
