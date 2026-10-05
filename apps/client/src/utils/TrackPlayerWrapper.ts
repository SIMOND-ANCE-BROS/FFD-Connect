/* eslint-disable @typescript-eslint/require-await */
/**
 * TrackPlayerWrapper.ts
 *
 * Audio engine for the app, backed by **expo-audio** (New Architecture native).
 *
 * History: this used to wrap `react-native-track-player`, but RNTP 4.1.2 is an
 * old-architecture module and produces NO sound under Expo SDK 57's New
 * Architecture (bridgeless). We migrated to expo-audio, which is New-Arch native.
 *
 * expo-audio is a single-player API with no built-in queue, so we keep a small
 * JS-managed queue here and re-expose the exact RNTP-compatible surface the rest
 * of the app already consumes (TrackPlayer.play/pause/add/skip/reset/…,
 * usePlaybackState, useProgress, addEventListener for
 * PlaybackState/PlaybackTrackChanged/PlaybackError).
 *
 * Lock-screen / Control Center controls ARE wired: each loaded track publishes
 * its metadata via expo-audio's setActiveForLockScreen/updateLockScreenMetadata
 * (see syncLockScreen), so play/pause and the scrubber work while locked. iOS
 * handles those commands natively and emits playbackStatusUpdate, which our
 * status listener already turns into PlaybackState — no extra RemotePlay wiring
 * needed. The ⏮ ⏭ buttons come from our local LockscreenTransport native
 * module (modules/lockscreen-transport — expo-audio never wires next/previous);
 * presses are handled here by setTransportEnabled's listeners.
 */
import { useEffect, useState } from "react";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioLockScreenOptions,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import LockscreenTransport from "../../modules/lockscreen-transport";

import {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  PitchAlgorithm,
  PlaybackErrorEvent,
  PlaybackProgress,
  PlaybackState,
  PlaybackTrackChangedEvent,
  PlayerOptions,
  RatingType,
  RemoteSeekEvent,
  RepeatMode,
  State,
  Track,
} from "../features/player/types";

// Re-export types/enums for consumers (unchanged surface).
export {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  PitchAlgorithm,
  RatingType,
  RepeatMode,
  State,
};
export type {
  PlaybackErrorEvent,
  PlaybackProgress,
  PlaybackState,
  PlaybackTrackChangedEvent,
  PlayerOptions,
  RemoteSeekEvent,
  Track,
};

// --- Internal singleton state ---------------------------------------------

let player: AudioPlayer | null = null;
let queue: Track[] = [];
let currentIndex = -1;
let repeatMode: RepeatMode = RepeatMode.Off;
let lastStatus: AudioStatus | null = null;
// Desired playback rate. expo-audio's replace() resets the rate to 1 on each
// new source, so we re-apply this once the freshly-loaded track is ready — this
// is what lets a locked tempo carry across track changes.
let currentRate = 1;
let pendingRateReapply = false;
// Whether this player currently owns the iOS/Android lock-screen "Now Playing"
// controls. Set on the first loaded track, cleared on reset().
let lockScreenActive = false;

// Lock-screen transport config for expo-audio's own commands (play/pause +
// scrubber). Seek ±10s stays off: the ⏮ ⏭ buttons come from our local
// LockscreenTransport module instead (expo-audio never wires next/previous).
const LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekForward: false,
  showSeekBackward: false,
  isLiveStream: false,
};

// One-time wiring guard for the LockscreenTransport listeners.
let transportWired = false;

// Show/hide the lock-screen ⏮ ⏭ buttons. Handled directly here — not via
// Event.RemoteNext listeners — because the wrapper owns the queue and this
// avoids double-handling if external listeners ever get registered.
// LockscreenTransport is null on Android/web/tests/old binaries → no-op.
function setTransportEnabled(enabled: boolean): void {
  if (!LockscreenTransport) return;
  try {
    if (enabled && !transportWired) {
      transportWired = true;
      LockscreenTransport.addListener("onRemoteNext", () => {
        // Same path as a track finishing naturally (honours repeat + the
        // shuffled queue order, and fires PlaybackTrackChanged for the UI).
        advance();
      });
      LockscreenTransport.addListener("onRemotePrevious", () => {
        if (!player) return;
        // Universal transport convention: >3s into the track (or already on
        // the first one) restarts it; otherwise go to the previous track.
        if ((lastStatus?.currentTime ?? 0) > 3 || currentIndex <= 0) {
          player.seekTo(0).catch(() => {});
          player.play();
        } else {
          loadIndex(currentIndex - 1);
          player.play();
        }
      });
    }
    LockscreenTransport.setEnabled(enabled);
  } catch {
    /* lock-screen transport is best-effort; never break playback */
  }
}

function toMetadata(t: Track): AudioMetadata {
  return {
    title: t.title,
    artist: t.artist,
    // artwork may be a require()'d number (ImageSourcePropType); the lock screen
    // only takes a remote/file URL string.
    artworkUrl: typeof t.artwork === "string" ? t.artwork : undefined,
  };
}

// Push the current track's metadata to the lock screen, activating this player
// as the "Now Playing" source on first use.
function syncLockScreen(t: Track): void {
  if (!player) return;
  try {
    if (lockScreenActive) {
      player.updateLockScreenMetadata(toMetadata(t));
    } else {
      player.setActiveForLockScreen(true, toMetadata(t), LOCK_SCREEN_OPTIONS);
      lockScreenActive = true;
      setTransportEnabled(true);
    }
  } catch {
    /* lock-screen controls are best-effort; never break playback */
  }
}

// Event listeners keyed by the app's Event enum (RNTP-compatible).
type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function emit(event: Event, data: unknown): void {
  listeners.get(event)?.forEach((l) => {
    try {
      l(data);
    } catch {
      /* a listener error must not break the status pipeline */
    }
  });
}

// Subscribers for the React hooks (usePlaybackState / useProgress).
const statusSubs = new Set<() => void>();
function notifyHooks(): void {
  statusSubs.forEach((fn) => fn());
}

function mapState(s: AudioStatus | null): State {
  if (!s?.isLoaded) return State.None;
  if (s.isBuffering) return State.Buffering;
  return s.playing ? State.Playing : State.Paused;
}

function loadIndex(i: number): void {
  const t = queue[i] as Track | undefined;
  if (!t || !player) return;
  const prev = currentIndex;
  currentIndex = i;
  player.replace({ uri: t.url });
  // replace() resets the rate; re-apply the desired rate once loaded.
  pendingRateReapply = currentRate !== 1;
  // Reflect the new track on the lock screen / Control Center.
  syncLockScreen(t);
  const payload: PlaybackTrackChangedEvent = {
    track: prev >= 0 ? prev : null,
    position: lastStatus?.currentTime ?? 0,
    nextTrack: i,
  };
  emit(Event.PlaybackTrackChanged, payload);
  emit(Event.PlaybackActiveTrackChanged, payload);
}

// Advance when a track finishes, honouring the repeat mode.
function advance(): void {
  if (!player) return;
  if (repeatMode === RepeatMode.Track) {
    player.seekTo(0).catch(() => {});
    player.play();
    return;
  }
  const next = currentIndex + 1;
  if (next < queue.length) {
    loadIndex(next);
    player.play();
  } else if (repeatMode === RepeatMode.Queue && queue.length > 0) {
    loadIndex(0);
    player.play();
  } else {
    emit(Event.PlaybackQueueEnded, {
      track: currentIndex,
      position: lastStatus?.currentTime ?? 0,
    });
  }
}

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      lastStatus = status;
      if (pendingRateReapply && status.isLoaded) {
        pendingRateReapply = false;
        player?.setPlaybackRate(currentRate);
      }
      emit(Event.PlaybackState, { state: mapState(status) });
      if (status.error) {
        emit(Event.PlaybackError, {
          code: "playback",
          message: status.error,
        } satisfies PlaybackErrorEvent);
      }
      if (status.didJustFinish) {
        advance();
      }
      notifyHooks();
    });
  }
  return player;
}

// --- RNTP-compatible imperative API ---------------------------------------

interface TrackPlayerInterface {
  setupPlayer(options?: PlayerOptions): Promise<void>;
  updateOptions(options?: PlayerOptions): Promise<void>;
  registerPlaybackService(serviceProvider: () => Promise<void> | void): void;
  addEventListener(
    event: Event,
    listener: (data: never) => void,
  ): { remove: () => void };
  add(tracks: Track | Track[], insertBeforeIndex?: number): Promise<void>;
  remove(indexes: number | number[]): Promise<void>;
  skip(index: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  reset(): Promise<void>;
  /**
   * Réordonne la file SANS toucher à la lecture en cours (utilisé par le shuffle).
   * La piste courante continue ; seul l'ordre des pistes suivantes change.
   * @param currentIndex position de la piste actuellement jouée dans le nouvel ordre.
   */
  setQueue(tracks: Track[], currentIndex: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<RepeatMode>;
  getVolume(): Promise<number>;
  getRate(): Promise<number>;
  getTrack(index: number): Promise<Track | null>;
  getQueue(): Promise<Track[]>;
  getCurrentTrack(): Promise<number | null>;
  getDuration(): Promise<number>;
  getPosition(): Promise<number>;
  getBufferedPosition(): Promise<number>;
  getState(): Promise<State>;
}

const TrackPlayer: TrackPlayerInterface = {
  setupPlayer: async () => {
    ensurePlayer();
    // Play through the ringer silent switch + keep audio alive in background.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Must be doNotMix for lock-screen "Now Playing" controls to attach to
      // this app (iOS requirement — see expo-audio setActiveForLockScreen docs).
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
      allowsRecording: false,
    });
  },

  updateOptions: async () => {
    /* capabilities/notification options are RNTP lock-screen config — n/a here */
  },

  registerPlaybackService: () => {
    /* RNTP headless service — not needed with expo-audio */
  },

  addEventListener: (event, listener) => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener as Listener);
    return {
      remove: () => {
        listeners.get(event)?.delete(listener as Listener);
      },
    };
  },

  add: async (tracks) => {
    const arr = Array.isArray(tracks) ? tracks : [tracks];
    const wasEmpty = queue.length === 0;
    queue.push(...arr);
    // Load the first track so a subsequent play() has something to play (the
    // single-track flow adds then plays without an explicit skip).
    if (wasEmpty && arr.length > 0) {
      loadIndex(0);
    }
  },

  remove: async () => {
    /* queue splicing is unused by the app */
  },

  setQueue: async (tracks, index) => {
    // Reorder the queue WITHOUT reloading the player → the current track keeps
    // playing (no restart). Only the upcoming order + current index change.
    queue = tracks;
    currentIndex = index;
  },

  skip: async (index) => {
    loadIndex(index);
  },

  skipToNext: async () => {
    advance();
  },

  skipToPrevious: async () => {
    if (currentIndex > 0 && player) {
      loadIndex(currentIndex - 1);
      player.play();
    }
  },

  reset: async () => {
    queue = [];
    currentIndex = -1;
    lastStatus = null;
    currentRate = 1;
    pendingRateReapply = false;
    if (player) {
      player.pause();
      if (lockScreenActive) {
        try {
          player.clearLockScreenControls();
        } catch {
          /* best-effort */
        }
        lockScreenActive = false;
        setTransportEnabled(false);
      }
    }
    notifyHooks();
  },

  play: async () => {
    ensurePlayer().play();
  },

  pause: async () => {
    player?.pause();
  },

  seekTo: async (seconds) => {
    await player?.seekTo(seconds);
  },

  setVolume: async (volume) => {
    if (player) player.volume = volume;
  },

  setRate: async (rate) => {
    currentRate = rate;
    player?.setPlaybackRate(rate);
  },

  setRepeatMode: async (mode) => {
    repeatMode = mode;
    if (player) player.loop = mode === RepeatMode.Track;
    return mode;
  },

  getVolume: async () => player?.volume ?? 1,
  getRate: async () => player?.playbackRate ?? 1,
  getTrack: async (index) => queue[index] ?? null,
  getQueue: async () => queue,
  getCurrentTrack: async () => {
    // Throw before setup so TrackPlayerService's try/catch triggers setup once.
    if (!player) throw new Error("Player not set up");
    return currentIndex >= 0 ? currentIndex : null;
  },
  getDuration: async () => lastStatus?.duration ?? 0,
  getPosition: async () => lastStatus?.currentTime ?? 0,
  getBufferedPosition: async () => 0,
  getState: async () => mapState(lastStatus),
};

// --- React hooks ------------------------------------------------------------

export function usePlaybackState(): PlaybackState {
  const [state, setState] = useState<State>(() => mapState(lastStatus));
  useEffect(() => {
    const update = () => setState(mapState(lastStatus));
    statusSubs.add(update);
    update();
    return () => {
      statusSubs.delete(update);
    };
  }, []);
  return { state };
}

export function useProgress(_updateInterval?: number): PlaybackProgress {
  const [progress, setProgress] = useState<PlaybackProgress>(() => ({
    position: lastStatus?.currentTime ?? 0,
    duration: lastStatus?.duration ?? 0,
    buffered: 0,
  }));
  useEffect(() => {
    const update = () =>
      setProgress({
        position: lastStatus?.currentTime ?? 0,
        duration: lastStatus?.duration ?? 0,
        buffered: 0,
      });
    statusSubs.add(update);
    update();
    return () => {
      statusSubs.delete(update);
    };
  }, []);
  return progress;
}

export default TrackPlayer;
