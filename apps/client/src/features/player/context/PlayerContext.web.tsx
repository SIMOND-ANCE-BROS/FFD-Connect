/**
 * Contexte lecteur pour le web : stub sans react-native-track-player.
 * La lecture audio est réservée à l’app mobile.
 */

import React, { createContext, ReactNode, useContext, useState } from "react";

import { PlayerRepeatMode, TrackData } from "../types";
export { PlayerRepeatMode as ContextRepeatMode };
export type { TrackData };

interface PlayerContextType {
  currentTrack: TrackData | null;
  isPlaying: boolean;
  isPlayerReady: boolean;
  queueTracks: TrackData[];
  setQueueTracks: React.Dispatch<React.SetStateAction<TrackData[]>>;
  playTrack: (
    track: TrackData,
    playlist?: TrackData[],
    forceRestart?: boolean,
  ) => Promise<void>;
  togglePlayback: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  resetPlayer: () => Promise<void>;
  likedTrackIds: string[];
  toggleLike: (trackId: string) => void;
  isLiked: (trackId: string) => boolean;
  repeatMode: PlayerRepeatMode;
  toggleRepeat: () => void;
  isShuffle: boolean;
  toggleShuffle: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const noop = () => Promise.resolve();
const noopSync = () => {};

export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const [currentTrack, _setCurrentTrack] = useState<TrackData | null>(null);
  const [queueTracks, setQueueTracks] = useState<TrackData[]>([]);
  const [likedTrackIds, setLikedTrackIds] = useState<string[]>([]);
  const [_repeatMode, _setRepeatMode] = useState<PlayerRepeatMode>(
    PlayerRepeatMode.Off,
  );
  const [isShuffle, setIsShuffle] = useState(false);

  const value: PlayerContextType = {
    currentTrack,
    isPlaying: false,
    isPlayerReady: false,
    queueTracks,
    setQueueTracks,
    playTrack: noop,
    togglePlayback: noop,
    pause: noop,
    resume: noop,
    seekTo: noop,
    resetPlayer: noop,
    likedTrackIds,
    toggleLike: (trackId: string) => {
      setLikedTrackIds((prev) =>
        prev.includes(trackId)
          ? prev.filter((id) => id !== trackId)
          : [...prev, trackId],
      );
    },
    isLiked: (trackId: string) => likedTrackIds.includes(trackId),
    repeatMode: _repeatMode,
    toggleRepeat: noopSync,
    isShuffle,
    toggleShuffle: () => setIsShuffle((p) => !p),
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
