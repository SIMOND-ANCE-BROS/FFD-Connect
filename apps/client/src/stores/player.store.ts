import { Alert } from "react-native";
import { create } from "zustand";
import { IS_PROD } from "../config";
import TrackPlayer, * as TrackPlayerUtils from "../utils/TrackPlayerWrapper";
import { createLogger } from "../utils/logger";
import { hasExtendedTrackData } from "../utils/typeGuards";
import { setupPlayer } from "../features/player/services/TrackPlayerService";
import { PlayerRepeatMode, TrackData } from "../features/player/types";
import {
  appendTrack,
  insertNext,
  moveTrack,
  removeTrackById,
  type QueueAddResult,
} from "../features/player/utils/queueOps";

export { PlayerRepeatMode };
export type { QueueAddResult, TrackData };

const logger = createLogger("player.store");

// Surface playback failures on non-prod builds (beta/dev). "Play does nothing"
// is otherwise invisible because every caller swallows errors with .catch().
// This tells us the exact reason (setup error / no URL / native throw) on device.
const reportPlaybackIssue = (where: string, detail?: unknown) => {
  const msg =
    detail instanceof Error
      ? detail.message
      : typeof detail === "string"
        ? detail
        : detail != null
          ? JSON.stringify(detail)
          : "";
  logger.warn(`Playback issue @ ${where}${msg ? `: ${msg}` : ""}`);
  if (!IS_PROD) {
    Alert.alert(
      "Lecture audio — diagnostic",
      `${where}${msg ? `\n\n${msg}` : ""}`,
    );
  }
};

const toTrackPlayerObject = (t: TrackData): TrackPlayerUtils.Track =>
  ({
    id: t.id,
    url: t.url,
    title: t.title,
    artist: t.artist,
    artwork: t.artwork ?? undefined,
    pitchAlgorithm: TrackPlayerUtils.PitchAlgorithm.Music,
    baseBpm: t.baseBpm,
    style: t.style,
    playlist: t.playlist,
  }) as TrackPlayerUtils.Track;

/**
 * Pushes an edited queue (add / move / remove) to the native player WITHOUT
 * reloading it: the current track keeps playing, only the upcoming order (used
 * by natural advance, lock-screen ⏮ ⏭ and repeat-queue) changes.
 */
const syncNativeQueue = (queue: TrackData[], currentId: string): void => {
  const currentIndex = queue.findIndex((t) => t.id === currentId);
  if (currentIndex === -1) return;
  void TrackPlayer.setQueue(queue.map(toTrackPlayerObject), currentIndex).catch(
    (e: unknown) => {
      logger.error("Failed to sync edited queue", e);
    },
  );
};

interface PlayerState {
  currentTrack: TrackData | null;
  isPlaying: boolean;
  isPlayerReady: boolean;
  queueTracks: TrackData[];
  _originalQueue: TrackData[];
  likedTrackIds: string[];
  repeatMode: PlayerRepeatMode;
  isShuffle: boolean;
  /**
   * Tempo (MPM) state, kept here — not in the player screen — so it survives
   * closing/reopening that screen. `tempo` = the MPM the given track plays at.
   */
  /**
   * Tempo lock, PER DANCE STYLE (see tempoStyleKey): a style is locked iff it
   * has an entry. Not persisted (in-memory for the session).
   */
  lockedMpmByStyle: Partial<Record<string, number>>;
  tempo: { trackId: string; mpm: number } | null;
  /** Locks `style` at `mpm`, or removes only that style's lock with `null`. */
  setStyleLock: (style: string, mpm: number | null) => void;
  setTempo: (trackId: string, mpm: number) => void;

  // Internal setters for PlayerStoreSync
  setIsPlaying: (v: boolean) => void;
  setCurrentTrack: (t: TrackData | null) => void;
  setQueueTracks: (tracks: TrackData[]) => void;

  // Actions
  ensurePlayerReady: () => Promise<boolean>;
  playTrack: (
    track: TrackData,
    playlist?: TrackData[],
    forceRestart?: boolean,
  ) => Promise<void>;
  /** « Lire ensuite » — inserts the track right after the current one. */
  playNext: (track: TrackData) => Promise<QueueAddResult>;
  /** « Ajouter à la file » — appends the track at the end of the queue. */
  addToQueue: (track: TrackData) => Promise<QueueAddResult>;
  /** Drag-and-drop reorder of the queue (indexes in `queueTracks`). */
  moveQueueTrack: (from: number, to: number) => void;
  /**
   * Removes a track from the queue (and the pre-shuffle order). The native
   * queue is re-synced unless the removed track is the current one — the
   * caller then decides what plays instead (see useAudioPlayerLogic).
   */
  removeFromQueue: (trackId: string) => void;
  togglePlayback: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  resetPlayer: () => Promise<void>;
  toggleLike: (trackId: string) => void;
  isLiked: (trackId: string) => boolean;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  _resetForTests: () => void;
}

type QueueInsert = (
  queue: TrackData[],
  track: TrackData,
  currentId: string | null,
) => TrackData[];

// Shared by playNext / addToQueue. With nothing loaded, adding starts a fresh
// queue with that track instead of silently queueing it.
const enqueue = async (
  get: () => PlayerState,
  set: (partial: Partial<PlayerState>) => void,
  track: TrackData,
  insert: QueueInsert,
): Promise<QueueAddResult> => {
  const { currentTrack, queueTracks, isShuffle, _originalQueue } = get();
  if (!currentTrack) {
    await get().playTrack(track, [track], true);
    return get().currentTrack?.id === track.id ? "started" : "failed";
  }
  if (track.id === currentTrack.id) return "unchanged";

  const base = queueTracks.length > 0 ? queueTracks : [currentTrack];
  const next = insert(base, track, currentTrack.id);
  set({
    queueTracks: next,
    // Keep the pre-shuffle order coherent: turning shuffle off must not drop
    // the tracks added meanwhile.
    ...(isShuffle
      ? { _originalQueue: insert(_originalQueue, track, currentTrack.id) }
      : {}),
  });
  syncNativeQueue(next, currentTrack.id);
  return "queued";
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  isPlayerReady: false,
  queueTracks: [],
  _originalQueue: [],
  likedTrackIds: [],
  repeatMode: PlayerRepeatMode.Off,
  isShuffle: false,
  lockedMpmByStyle: {},
  tempo: null,

  setStyleLock: (style, mpm) =>
    set((st) => {
      const next = { ...st.lockedMpmByStyle };
      if (mpm === null) delete next[style];
      else next[style] = mpm;
      return { lockedMpmByStyle: next };
    }),
  setTempo: (trackId, mpm) => set({ tempo: { trackId, mpm } }),

  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTrack: (t) => set({ currentTrack: t }),
  setQueueTracks: (tracks) => set({ queueTracks: tracks }),

  ensurePlayerReady: async () => {
    if (get().isPlayerReady) {
      return true;
    }
    try {
      const ready = await setupPlayer();
      if (ready) {
        set({ isPlayerReady: true });
      }
      if (!ready) {
        reportPlaybackIssue("setupPlayer a échoué (isSetup=false)");
      }
      return ready;
    } catch (e) {
      reportPlaybackIssue("setupPlayer a levé une erreur", e);
      return false;
    }
  },

  playTrack: async (track, playlist, forceRestart = false) => {
    const urlStatus =
      !track.url || track.url === ""
        ? "empty"
        : `length=${String(track.url).length}`;
    logger.debug("playTrack called", {
      title: track.title,
      url: urlStatus,
      hasArtwork: Boolean(track.artwork),
    });

    if (!track.url || track.url === "") {
      reportPlaybackIssue(
        "URL de piste vide (vérifier EXPO_PUBLIC_API_URL / filename)",
      );
      return;
    }

    const ready = await get().ensurePlayerReady();
    if (!ready) {
      // ensurePlayerReady already reported the specific reason.
      return;
    }

    const { repeatMode, currentTrack } = get();

    const applyRepeatMode = async (mode: PlayerRepeatMode) => {
      const trackPlayerMode =
        mode === PlayerRepeatMode.Off
          ? TrackPlayerUtils.RepeatMode.Off
          : mode === PlayerRepeatMode.Queue
            ? TrackPlayerUtils.RepeatMode.Queue
            : TrackPlayerUtils.RepeatMode.Track;
      await TrackPlayer.setRepeatMode(trackPlayerMode);
    };

    if (playlist && playlist.length > 0) {
      try {
        set({ queueTracks: playlist });
        const queue = playlist.map(toTrackPlayerObject);
        const startIndex = playlist.findIndex((t) => t.id === track.id);
        const safeIndex = startIndex !== -1 ? startIndex : 0;

        await TrackPlayer.reset();
        await TrackPlayer.add(queue);

        if (safeIndex > 0) {
          await TrackPlayer.skip(safeIndex);
        }

        await applyRepeatMode(repeatMode);
        await TrackPlayer.play();
        set({ currentTrack: track });
      } catch (error) {
        reportPlaybackIssue("Erreur lecture playlist", error);
      }
    } else {
      try {
        set({ queueTracks: [track] });
        const trackPlayerObject = toTrackPlayerObject(track);

        if (currentTrack?.id === track.id && !forceRestart) {
          await get().togglePlayback();
          return;
        }

        await TrackPlayer.reset();
        await TrackPlayer.add(trackPlayerObject);
        await applyRepeatMode(repeatMode);
        await TrackPlayer.play();
        set({ currentTrack: track });
      } catch (error) {
        reportPlaybackIssue("Erreur lecture piste", error);
      }
    }
  },

  playNext: (track) => enqueue(get, set, track, insertNext),

  addToQueue: (track) => enqueue(get, set, track, appendTrack),

  moveQueueTrack: (from, to) => {
    const { queueTracks, currentTrack } = get();
    const next = moveTrack(queueTracks, from, to);
    if (next === queueTracks) return;
    set({ queueTracks: next });
    if (currentTrack) syncNativeQueue(next, currentTrack.id);
  },

  removeFromQueue: (trackId) => {
    const { queueTracks, _originalQueue, currentTrack } = get();
    const next = removeTrackById(queueTracks, trackId);
    set({
      queueTracks: next,
      _originalQueue: removeTrackById(_originalQueue, trackId),
    });
    if (currentTrack && currentTrack.id !== trackId) {
      syncNativeQueue(next, currentTrack.id);
    }
  },

  togglePlayback: async () => {
    const ready = await get().ensurePlayerReady();
    if (!ready) return;

    try {
      const state = await TrackPlayer.getState();
      if (state === TrackPlayerUtils.State.Playing) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    } catch (error) {
      reportPlaybackIssue("Erreur play/pause", error);
    }
  },

  pause: async () => {
    await TrackPlayer.pause();
  },

  resume: async () => {
    await TrackPlayer.play();
  },

  seekTo: async (seconds) => {
    await TrackPlayer.seekTo(seconds);
  },

  setPlaybackRate: async (rate) => {
    await TrackPlayer.setRate(rate);
  },

  resetPlayer: async () => {
    await TrackPlayer.reset();
    set({ currentTrack: null, queueTracks: [] });
  },

  toggleLike: (trackId) => {
    set((state) => ({
      likedTrackIds: state.likedTrackIds.includes(trackId)
        ? state.likedTrackIds.filter((id) => id !== trackId)
        : [...state.likedTrackIds, trackId],
    }));
  },

  isLiked: (trackId) => get().likedTrackIds.includes(trackId),

  toggleRepeat: () => {
    set((state) => {
      const next =
        state.repeatMode === PlayerRepeatMode.Off
          ? PlayerRepeatMode.Queue
          : state.repeatMode === PlayerRepeatMode.Queue
            ? PlayerRepeatMode.Track
            : PlayerRepeatMode.Off;

      // Apply to TrackPlayer asynchronously
      const trackPlayerMode =
        next === PlayerRepeatMode.Off
          ? TrackPlayerUtils.RepeatMode.Off
          : next === PlayerRepeatMode.Queue
            ? TrackPlayerUtils.RepeatMode.Queue
            : TrackPlayerUtils.RepeatMode.Track;

      TrackPlayer.setRepeatMode(trackPlayerMode).catch((e: unknown) => {
        logger.error("Failed to set repeat mode", e);
      });

      return { repeatMode: next };
    });
  },

  toggleShuffle: () => {
    const { isShuffle, queueTracks, currentTrack, _originalQueue } = get();

    if (!isShuffle) {
      // Turning shuffle ON: save original order, then shuffle keeping current track first
      const shuffled = [...queueTracks];
      const currentIndex = currentTrack
        ? shuffled.findIndex((t) => t.id === currentTrack.id)
        : -1;

      // Move current track to front
      if (currentIndex > 0) {
        const [current] = shuffled.splice(currentIndex, 1);
        shuffled.unshift(current);
      }

      // Fisher-Yates shuffle on everything after index 0
      for (let i = shuffled.length - 1; i > 1; i--) {
        const j = 1 + Math.floor(Math.random() * i); // j in [1, i]
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      set({
        isShuffle: true,
        _originalQueue: [...queueTracks],
        queueTracks: shuffled,
      });

      // Sync TrackPlayer native queue
      // Reorder the queue WITHOUT restarting the current track: it stays at
      // index 0 and keeps playing; only the upcoming order changes.
      void TrackPlayer.setQueue(shuffled.map(toTrackPlayerObject), 0).catch(
        (e: unknown) => {
          logger.error("Failed to sync shuffled queue", e);
        },
      );
    } else {
      // Turning shuffle OFF: restore original order
      const restored = _originalQueue.length > 0 ? _originalQueue : queueTracks;

      set({
        isShuffle: false,
        queueTracks: restored,
        _originalQueue: [],
      });

      // Sync TrackPlayer native queue
      const currentIdx = currentTrack
        ? restored.findIndex((t) => t.id === currentTrack.id)
        : 0;

      // Reorder the queue WITHOUT restarting the current track: keep it playing
      // at its position in the restored order; only the upcoming order changes.
      void TrackPlayer.setQueue(
        restored.map(toTrackPlayerObject),
        Math.max(0, currentIdx),
      ).catch((e: unknown) => {
        logger.error("Failed to restore original queue", e);
      });
    }
  },

  _resetForTests: () => {
    set({
      currentTrack: null,
      isPlaying: false,
      isPlayerReady: false,
      queueTracks: [],
      _originalQueue: [],
      likedTrackIds: [],
      repeatMode: PlayerRepeatMode.Off,
      isShuffle: false,
      lockedMpmByStyle: {},
      tempo: null,
    });
  },
}));

// Re-export hasExtendedTrackData for use in PlayerStoreSync
export { hasExtendedTrackData };
