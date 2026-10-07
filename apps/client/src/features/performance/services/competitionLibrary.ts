/**
 * Loads the music a competition can use:
 * - the WHOLE dance catalogue (the library context only holds the pages the
 *   user scrolled through — 30 tracks at first — so dances were reported as
 *   missing although the server had them);
 * - the « Ambiance » tracks (pause music), excluded from GET /tracks and
 *   served by GET /tracks/ambiance.
 */
import { TrackApi } from "../../../services/api/track-api";
import { createLogger } from "../../../utils/logger";
import type { TrackData } from "../../player/context/PlayerContext";
import type { TrackRepository } from "../../player/services/TrackRepository";
import { toTrackData } from "../../player/services/trackMapping";
import { isAmbianceTrack } from "../utils/competitionProgram";

const logger = createLogger("competitionLibrary");

const PAGE_SIZE = 100; // backend max (PaginationParamsDto @Max(100))
const MAX_PAGES = 20;

type Repo = Pick<
  TrackRepository,
  "getTracksPage" | "getTrackUrl" | "getArtworkUrl"
>;

export interface CompetitionLibrary {
  tracks: TrackData[];
  ambiance: TrackData[];
}

const mergeById = (preferred: TrackData[], extra: TrackData[]) => {
  const seen = new Set(preferred.map((t) => t.id));
  return [...preferred, ...extra.filter((t) => !seen.has(t.id))];
};

async function fetchCatalogue(repo: Repo): Promise<TrackData[]> {
  const all: TrackData[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { tracks, hasMore } = await repo.getTracksPage(
      page * PAGE_SIZE,
      PAGE_SIZE,
    );
    all.push(...tracks.map((t) => toTrackData(t, repo)));
    if (!hasMore || tracks.length === 0) break;
  }
  return all;
}

/**
 * @param known tracks already loaded by the library (kept first: they may
 *   point to an offline copy).
 */
export async function loadCompetitionLibrary(
  repo: Repo | null,
  known: TrackData[],
): Promise<CompetitionLibrary> {
  let catalogue: TrackData[] = [];
  if (repo) {
    try {
      catalogue = await fetchCatalogue(repo);
    } catch (e) {
      logger.warn("Full catalogue fetch failed, using loaded library", e);
    }
  }

  let ambianceRemote: TrackData[] = [];
  if (repo) {
    try {
      ambianceRemote = (await TrackApi.getAmbianceTracks()).map((t) =>
        toTrackData(t, repo),
      );
    } catch (e) {
      // No pause music is not fatal: breaks are simply silent.
      logger.warn("Ambiance tracks fetch failed (silent breaks)", e);
    }
  }

  const merged = mergeById(known, catalogue);
  const ambiance = mergeById(
    ambianceRemote,
    merged.filter(isAmbianceTrack),
  ).filter((t) => Boolean(t.url));
  return {
    tracks: merged.filter((t) => !isAmbianceTrack(t)),
    ambiance,
  };
}
