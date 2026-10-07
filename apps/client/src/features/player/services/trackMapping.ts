import type { TrackData } from "../context/PlayerContext";
import { localTrackUri } from "./TrackOfflineService";
import type { Track, TrackRepository } from "./TrackRepository";

/**
 * Maps a backend track (GET /tracks, GET /tracks/ambiance) to the TrackData
 * consumed by the player. Single source of truth shared by the library and
 * the competition mode so both build URLs/artwork the same way.
 *
 * @param isDownloaded a local copy exists (favourite download or import) →
 *   play it offline instead of streaming (#416).
 */
export function toTrackData(
  track: Track,
  repo: Pick<TrackRepository, "getTrackUrl" | "getArtworkUrl">,
  isDownloaded = false,
): TrackData {
  return {
    id: String(track.id),
    title: String(track.title),
    artist: String(track.artist),
    url: isDownloaded
      ? localTrackUri(track.filename)
      : repo.getTrackUrl(track.filename),
    baseBpm: track.bpm,
    style: track.style ?? "Importé",
    artwork: repo.getArtworkUrl(track.artwork),
    playlist: "Tout",
    titleMasked: track.titleMasked ?? false,
    isDownloaded,
    clashTimecodes: track.clashTimecodes,
  };
}
