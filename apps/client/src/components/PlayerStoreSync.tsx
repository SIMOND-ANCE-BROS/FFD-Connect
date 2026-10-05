import { useEffect } from "react";
import TrackPlayer, * as TrackPlayerUtils from "../utils/TrackPlayerWrapper";
import { usePlayerStore, hasExtendedTrackData } from "../stores/player.store";
import { TrackData } from "../features/player/types";
import { createLogger } from "../utils/logger";

const logger = createLogger("PlayerStoreSync");

export const PlayerStoreSync = () => {
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const ensurePlayerReady = usePlayerStore((s) => s.ensurePlayerReady);

  const playbackState = TrackPlayerUtils.usePlaybackState();

  useEffect(() => {
    setIsPlaying(playbackState.state === TrackPlayerUtils.State.Playing);
  }, [playbackState.state, setIsPlaying]);

  useEffect(() => {
    void ensurePlayerReady();

    const sub1 = TrackPlayer.addEventListener(
      TrackPlayerUtils.Event.PlaybackError,
      (e: TrackPlayerUtils.PlaybackErrorEvent) => {
        logger.error("TrackPlayer error:", e);
      },
    );

    const sub2 = TrackPlayer.addEventListener(
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

              const trackData: TrackData = {
                id: track.id,
                url: typeof track.url === "string" ? track.url : "",
                title: track.title ?? "",
                artist: track.artist ?? "",
                artwork:
                  typeof track.artwork === "string" ? track.artwork : undefined,
                baseBpm: (extendedData as { baseBpm?: number }).baseBpm ?? 0,
                style: (extendedData as { style?: string }).style,
                playlist: (extendedData as { playlist?: string }).playlist,
              };
              setCurrentTrack(trackData);
            }
          }
        })();
      },
    );

    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [ensurePlayerReady, setCurrentTrack]);

  return null;
};
