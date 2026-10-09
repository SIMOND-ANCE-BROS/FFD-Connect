/**
 * PlayerContext.tsx — re-exports from Zustand player.store for backwards compatibility.
 * PlayerProvider resets state on mount, calls ensurePlayerReady, and registers TrackPlayer
 * event listeners (same behaviour as the original Context). For the full app, prefer
 * mounting <PlayerStoreSync /> once near the root instead.
 */
import React, { ReactNode, useEffect } from "react";
import TrackPlayer, * as TrackPlayerUtils from "../../../utils/TrackPlayerWrapper";
import {
  usePlayerStore,
  PlayerRepeatMode as ContextRepeatMode,
  hasExtendedTrackData,
  TrackData,
} from "../../../stores/player.store";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("PlayerContext");

export { usePlayerStore };
export { ContextRepeatMode };
export type { TrackData };

// Backwards-compatible usePlayer hook — uses individual selectors to avoid
// re-rendering consumers on every store change.
export const usePlayer = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isPlayerReady = usePlayerStore((s) => s.isPlayerReady);
  const queueTracks = usePlayerStore((s) => s.queueTracks);
  const likedTrackIds = usePlayerStore((s) => s.likedTrackIds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const moveQueueTrack = usePlayerStore((s) => s.moveQueueTrack);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const resetPlayer = usePlayerStore((s) => s.resetPlayer);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const isLiked = usePlayerStore((s) => s.isLiked);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const ensurePlayerReady = usePlayerStore((s) => s.ensurePlayerReady);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueueTracks = usePlayerStore((s) => s.setQueueTracks);
  const _resetForTests = usePlayerStore((s) => s._resetForTests);

  return {
    currentTrack,
    isPlaying,
    isPlayerReady,
    queueTracks,
    likedTrackIds,
    repeatMode,
    isShuffle,
    playTrack,
    playNext,
    addToQueue,
    moveQueueTrack,
    removeFromQueue,
    togglePlayback,
    pause,
    resume,
    seekTo,
    resetPlayer,
    toggleLike,
    isLiked,
    toggleRepeat,
    toggleShuffle,
    ensurePlayerReady,
    setIsPlaying,
    setCurrentTrack,
    setQueueTracks,
    _resetForTests,
  };
};

// Backwards-compatible PlayerProvider — resets store on mount and registers listeners
export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const ensurePlayerReady = usePlayerStore((s) => s.ensurePlayerReady);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const _resetForTests = usePlayerStore((s) => s._resetForTests);

  useEffect(() => {
    _resetForTests();

    let sub1: { remove: () => void } | null = null;
    let subState: { remove: () => void } | null = null;
    let sub2: { remove: () => void } | null = null;
    let mounted = true;

    void ensurePlayerReady().then((ready) => {
      if (!ready || !mounted) return;

      sub1 = TrackPlayer.addEventListener(
        TrackPlayerUtils.Event.PlaybackError,
        (e: TrackPlayerUtils.PlaybackErrorEvent) => {
          logger.error("TrackPlayer Playback Error:", e);
        },
      );

      subState = TrackPlayer.addEventListener(
        TrackPlayerUtils.Event.PlaybackState,
        (e: { state: TrackPlayerUtils.State }) => {
          logger.debug("TrackPlayer State:", e);
        },
      );

      sub2 = TrackPlayer.addEventListener(
        TrackPlayerUtils.Event.PlaybackTrackChanged,
        (e: TrackPlayerUtils.PlaybackTrackChangedEvent) => {
          void (async () => {
            logger.debug("Track Changed:", e);
            if (e.nextTrack !== null) {
              const track = await TrackPlayer.getTrack(e.nextTrack);
              if (track) {
                const extendedData = hasExtendedTrackData(track)
                  ? track
                  : { baseBpm: 0, style: undefined, playlist: undefined };
                setCurrentTrack({
                  id: track.id,
                  url: typeof track.url === "string" ? track.url : "",
                  title: track.title ?? "",
                  artist: track.artist ?? "",
                  artwork:
                    typeof track.artwork === "string"
                      ? track.artwork
                      : undefined,
                  baseBpm: (extendedData as { baseBpm?: number }).baseBpm ?? 0,
                  style: (extendedData as { style?: string }).style,
                  playlist: (extendedData as { playlist?: string }).playlist,
                });
              }
            }
          })();
        },
      );
    });

    return () => {
      mounted = false;
      sub1?.remove();
      subState?.remove();
      sub2?.remove();
    };
  }, []);

  return React.createElement(React.Fragment, null, children);
};
