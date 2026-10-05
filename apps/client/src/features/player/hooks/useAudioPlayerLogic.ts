import { useEffect, useRef, useState } from "react";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import TrackPlayer, { useProgress } from "../../../utils/TrackPlayerWrapper";
import { usePlayerStore } from "../../../stores/player.store";
import { ContextRepeatMode, TrackData, usePlayer } from "../context";

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
  } = usePlayer();
  const { handleError } = useErrorHandler();
  const [isLoading] = useState(false);
  const [errorMessage] = useState<string | null>(null);

  const [isQueueVisible, setIsQueueVisible] = useState(false);

  // BPM State
  const [bpm, setBpm] = useState(123);
  const [isBpmVisible, setIsBpmVisible] = useState(false);
  // Tempo lock: when on, the tempo OFFSET (e.g. -5 MPM) is kept across track
  // changes — each new track plays at its own base tempo plus that offset,
  // NOT at a fixed absolute MPM.
  const [isTempoLocked, setIsTempoLocked] = useState(false);
  // Last user-set offset (bpm - baseMpm), captured against the track it was set
  // on. Read (not a dep) in the track-change effect so it re-applies on lock.
  const bpmDiffRef = useRef(0);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  useEffect(() => {
    if (!currentTrack || queueTracks.length > 0) {
      return;
    }

    setQueueTracks([currentTrack]);
  }, [currentTrack, queueTracks.length, setQueueTracks]);

  useEffect(() => {
    if (!currentTrack) return;
    const newBase = Math.round(currentTrack.baseBpm || 123);
    if (isTempoLocked && newBase > 0) {
      // Preserve the OFFSET: new MPM = this track's base + locked diff, clamped
      // to the ±50% range, then re-apply the matching playback rate.
      const target = Math.max(
        Math.round(newBase * 0.5),
        Math.min(newBase + bpmDiffRef.current, Math.round(newBase * 1.5)),
      );
      setBpm(target);
      if (isPlayerReady) void setPlaybackRate(target / newBase);
    } else {
      setBpm(newBase);
    }
  }, [currentTrack, isTempoLocked, isPlayerReady, setPlaybackRate]);

  const displayTrack: TrackData = currentTrack ?? {
    id: "empty",
    url: "",
    title: "No Track",
    artist: "-",
    baseBpm: 120,
    playlist: "Lecteur",
  };

  const baseMpm = displayTrack.baseBpm ? Math.round(displayTrack.baseBpm) : 30;
  const minMpm = baseMpm * 0.5;
  const maxMpm = baseMpm * 1.5;
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
    setQueueTracks(next);

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
    setBpm(value);
    // Remember the offset from THIS track's base so the lock can re-apply it
    // (e.g. -5) to other tracks.
    bpmDiffRef.current = value - baseMpm;
    if (!isPlayerReady) {
      return;
    }
    const rate = value / baseMpm;
    await setPlaybackRate(rate);
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
      toggleTempoLock: () => setIsTempoLocked((v) => !v),
      setIsBpmVisible,
      seekTo,
      toggleLike: () => toggleLike(displayTrack.id),
      toggleRepeat,
      toggleShuffle,
      openQueue: () => setIsQueueVisible(true),
      closeQueue: () => setIsQueueVisible(false),
      playQueueTrack,
      removeQueueTrack,
    },
  };
};
