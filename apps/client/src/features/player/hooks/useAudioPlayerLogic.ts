import { useEffect, useState } from "react";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import TrackPlayer, { useProgress } from "../../../utils/TrackPlayerWrapper";
import { usePerformanceStore } from "../../../stores/performance.store";
import { usePlayerStore } from "../../../stores/player.store";
import { ContextRepeatMode, TrackData, usePlayer } from "../context";
import {
  clampMpm,
  mpmRange,
  resolveBaseMpm,
  tempoStyleKey,
} from "../utils/tempo";

export interface UseAudioPlayerLogicReturn {
  state: {
    tracks: TrackData[];
    currentTrack: TrackData;
    isPlaying: boolean;
    isPlayerReady: boolean;
    bpm: number;
    baseMpm: number;
    minMpm: number;
    maxMpm: number;
    bpmDiff: number;
    isBpmVisible: boolean;
    isTempoLocked: boolean;
    progress: { position: number; duration: number };
    isLoading: boolean;
    errorMessage: string | null;
    isLiked: boolean;
    repeatMode: ContextRepeatMode;
    isShuffle: boolean;
    isQueueVisible: boolean;
  };
  actions: {
    togglePlayback: () => void;
    handleNext: () => void;
    handlePrev: () => void;
    changeBpm: (value: number) => Promise<void>;
    resetBpm: () => Promise<void>;
    toggleTempoLock: () => void;
    setIsBpmVisible: (visible: boolean) => void;
    seekTo: (seconds: number) => Promise<void>;
    toggleLike: () => void;
    toggleRepeat: () => void;
    toggleShuffle: () => void;
    openQueue: () => void;
    closeQueue: () => void;
    playQueueTrack: (trackId: string) => Promise<void>;
    removeQueueTrack: (trackId: string) => void;
    moveQueueTrack: (from: number, to: number) => void;
  };
}

export const useAudioPlayerLogic = (): UseAudioPlayerLogicReturn => {
  const {
    currentTrack,
    isPlaying,
    togglePlayback,
    isPlayerReady,
    playTrack,
    resetPlayer,
    isLiked,
    toggleLike,
    repeatMode,
    toggleRepeat,
    isShuffle,
    toggleShuffle,
    queueTracks,
    setQueueTracks,
    moveQueueTrack,
    removeFromQueue,
  } = usePlayer();
  const { handleError } = useErrorHandler();
  const [isLoading] = useState(false);
  const [errorMessage] = useState<string | null>(null);

  const [isQueueVisible, setIsQueueVisible] = useState(false);

  // BPM State — lives in the player store so it survives closing/reopening
  // this screen. Tempo lock is PER DANCE STYLE: the lock button locks or
  // unlocks the current track's style only. A new track plays at its style's
  // locked MPM (clamped to its own ±50% range, without overwriting the stored
  // lock), or at its original tempo — freely adjustable — when its style is
  // not locked. A Rumba lock (18 MPM) thus never drags a Paso Doble (~60 MPM)
  // to the bottom of its range, and coming back to Rumba restores 18 exactly.
  const [isBpmVisible, setIsBpmVisible] = useState(false);
  const tempo = usePlayerStore((s) => s.tempo);
  const setTempo = usePlayerStore((s) => s.setTempo);
  const setStyleLock = usePlayerStore((s) => s.setStyleLock);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  useEffect(() => {
    if (!currentTrack || queueTracks.length > 0) {
      return;
    }

    setQueueTracks([currentTrack]);
  }, [currentTrack, queueTracks.length, setQueueTracks]);

  // Applies the tempo once per new track (not on remount, not on lock toggle).
  const currentTrackId = currentTrack?.id;
  const currentTrackBase = currentTrack?.baseBpm;
  const currentStyleKey = tempoStyleKey(currentTrack?.style, currentTrack?.id);
  const isTempoLocked = usePlayerStore(
    (s) => s.lockedMpmByStyle[currentStyleKey] !== undefined,
  );
  useEffect(() => {
    if (!currentTrackId || !isPlayerReady) return;
    const st = usePlayerStore.getState();
    if (st.tempo?.trackId === currentTrackId) return;
    const newBase = resolveBaseMpm(currentTrackBase);
    // A competition plays on the same player at the original tempo (it resets
    // the rate itself): never carry the library tempo onto its tracks.
    const competition = usePerformanceStore.getState().status;
    if (competition !== "idle" && competition !== "finished") {
      setTempo(currentTrackId, newBase);
      return;
    }
    const locked = st.lockedMpmByStyle[currentStyleKey];
    const target = locked === undefined ? newBase : clampMpm(locked, newBase);
    setTempo(currentTrackId, target);
    // Always set: the player re-applies its last rate to every new track.
    void setPlaybackRate(target / newBase);
  }, [
    currentTrackId,
    currentTrackBase,
    currentStyleKey,
    isPlayerReady,
    setPlaybackRate,
    setTempo,
  ]);

  const displayTrack: TrackData = currentTrack ?? {
    id: "empty",
    url: "",
    title: "No Track",
    artist: "-",
    baseBpm: 120,
    playlist: "Lecteur",
  };

  const baseMpm = resolveBaseMpm(displayTrack.baseBpm);
  const { min: minMpm, max: maxMpm } = mpmRange(baseMpm);
  // Clamped defensively so the label, the diff and the slider thumb can never
  // disagree with the slider bounds (the rate is derived from the same value).
  const bpm = clampMpm(
    tempo?.trackId === displayTrack.id ? tempo.mpm : baseMpm,
    baseMpm,
  );
  const bpmDiff = bpm - baseMpm;

  // Navigation Logic
  const playTrackFromList = async (index: number, list: TrackData[]) => {
    if (index < 0 || index >= list.length) return;
    const track = list[index];
    const trackData: TrackData = {
      ...track,
      playlist: track.playlist ?? displayTrack.playlist,
    };
    const contextPlaylist = list.map((item) => ({
      ...item,
      playlist: item.playlist ?? trackData.playlist,
    }));
    await playTrack(trackData, contextPlaylist);
  };

  const playTrackAtIndex = async (index: number) => {
    await playTrackFromList(index, queueTracks);
  };

  const playQueueTrack = async (trackId: string) => {
    const index = queueTracks.findIndex((track) => track.id === trackId);
    await playTrackAtIndex(index);
  };

  const removeQueueTrack = (trackId: string) => {
    const index = queueTracks.findIndex((track) => track.id === trackId);
    if (index === -1) {
      return;
    }

    const next = queueTracks.filter((track) => track.id !== trackId);
    // Updates the queue + pre-shuffle order and re-syncs the native queue when
    // the removed track is not the one playing.
    removeFromQueue(trackId);

    if (currentTrack?.id === trackId) {
      if (next.length === 0) {
        resetPlayer().catch((error) =>
          handleError(error, {
            logError: true,
            showAlert: false,
          }),
        );
      } else {
        const nextIndex = Math.min(index, next.length - 1);
        playTrackFromList(nextIndex, next).catch((error) =>
          handleError(error, {
            logError: true,
            showAlert: false,
          }),
        );
      }
    }
  };

  const handleNext = () => {
    if (!currentTrack) return;

    const queue = queueTracks;
    if (queue.length === 0) return;

    // Shuffle Logic
    if (isShuffle) {
      if (queue.length === 1) {
        return;
      }

      const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
      let randomIndex = Math.floor(Math.random() * queue.length);
      if (currentIndex !== -1) {
        while (randomIndex === currentIndex) {
          randomIndex = Math.floor(Math.random() * queue.length);
        }
      }
      playTrackAtIndex(randomIndex).catch((error) =>
        handleError(error, {
          logError: true,
          showAlert: false,
        }),
      );
      return;
    }

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    let nextIndex = currentIndex + 1;

    // Repeat Logic
    if (repeatMode === ContextRepeatMode.Track) {
      nextIndex = currentIndex;
    } else if (nextIndex >= queue.length) {
      if (repeatMode === ContextRepeatMode.Queue) {
        nextIndex = 0;
      } else {
        return;
      }
    }

    playTrackAtIndex(nextIndex).catch((error) =>
      handleError(error, {
        logError: true,
        showAlert: false,
      }),
    );
  };

  const handlePrev = () => {
    if (!currentTrack || queueTracks.length === 0) return;
    const currentIndex = queueTracks.findIndex((t) => t.id === currentTrack.id);

    if (repeatMode === ContextRepeatMode.Track) {
      playTrackAtIndex(currentIndex).catch((error) =>
        handleError(error, {
          logError: true,
          showAlert: false,
        }),
      );
      return;
    }

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = queueTracks.length - 1;
    }

    playTrackAtIndex(prevIndex).catch((error) =>
      handleError(error, {
        logError: true,
        showAlert: false,
      }),
    );
  };

  const changeBpm = async (value: number) => {
    if (!isPlayerReady || !currentTrack) {
      return;
    }
    const mpm = clampMpm(value, baseMpm);
    setTempo(currentTrack.id, mpm);
    // A locked MPM follows the last value set by hand (for this style).
    if (isTempoLocked) setStyleLock(currentStyleKey, mpm);
    await setPlaybackRate(mpm / baseMpm);
  };

  const resetBpm = async () => {
    await changeBpm(baseMpm);
  };

  const seekTo = async (seconds: number) => {
    if (!isPlayerReady) {
      return;
    }
    await TrackPlayer.seekTo(seconds);
  };

  const progress = useProgress();

  return {
    state: {
      tracks: queueTracks,
      currentTrack: displayTrack,
      isPlaying,
      isPlayerReady,
      bpm,
      baseMpm,
      minMpm,
      maxMpm,
      bpmDiff,
      isBpmVisible,
      isTempoLocked,
      progress,
      isLoading,
      errorMessage,
      isLiked: isLiked(displayTrack.id),
      repeatMode,
      isShuffle,
      isQueueVisible,
    },
    actions: {
      togglePlayback: () => {
        togglePlayback().catch((error) =>
          handleError(error, {
            logError: true,
            showAlert: false,
          }),
        );
      },
      handleNext,
      handlePrev,
      changeBpm,
      resetBpm,
      // Locks the current style at the MPM on screen, or removes only that
      // style's lock; other styles' locks are untouched.
      toggleTempoLock: () => {
        // No track loaded: the screen shows a placeholder, nothing to lock.
        if (!currentTrack) return;
        setStyleLock(currentStyleKey, isTempoLocked ? null : bpm);
      },
      setIsBpmVisible,
      seekTo,
      toggleLike: () => toggleLike(displayTrack.id),
      toggleRepeat,
      toggleShuffle,
      openQueue: () => setIsQueueVisible(true),
      closeQueue: () => setIsQueueVisible(false),
      playQueueTrack,
      removeQueueTrack,
      moveQueueTrack,
    },
  };
};
