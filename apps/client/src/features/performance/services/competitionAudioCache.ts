/**
 * Pre-download of every audio file a competition needs, BEFORE it starts.
 *
 * Streaming tracks on the fly made the first seconds of each dance silent
 * (buffering) while the dance countdown was already running. The competition
 * now plays exclusively from local `file://` copies kept in the cache
 * directory (the OS may purge it; files are re-downloaded when missing).
 */
import { cacheDirectory, getInfoAsync } from "expo-file-system/legacy";
import type { TrackData } from "../../player/context/PlayerContext";
import { downloadToFile } from "../../player/services/TrackOfflineService";
import { createLogger } from "../../../utils/logger";
import { stableCacheKey } from "../../../utils/stableHash";

const logger = createLogger("competitionAudioCache");

const CACHE_PREFIX = "perf_v1_";
const KNOWN_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|flac|mp4)$/i;

const extensionOf = (url: string): string => {
  const path = url.split(/[?#]/)[0];
  const match = KNOWN_EXTENSIONS.exec(path);
  return match ? match[0].toLowerCase() : ".mp3";
};

/**
 * Deterministic cache location for a track: the id plus a hash of the remote
 * URL (a re-uploaded file gets a new filename on the server → new cache entry).
 */
export const trackCacheUri = (track: { id: string; url: string }): string => {
  const safeId = String(track.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${cacheDirectory ?? ""}${CACHE_PREFIX}${safeId}_${stableCacheKey(
    track.url,
  )}${extensionOf(track.url)}`;
};

const isLocal = (url: string) =>
  url.startsWith("file://") || url.startsWith("/");

const fileExists = async (uri: string): Promise<boolean> => {
  try {
    const info = await getInfoAsync(uri);
    return info.exists && info.size !== 0;
  } catch {
    return false;
  }
};

export class TrackDownloadError extends Error {
  constructor(public readonly track: TrackData) {
    super(`Téléchargement impossible : ${track.title}`);
    this.name = "TrackDownloadError";
  }
}

/**
 * Returns a local `file://` uri for the track, downloading it if needed.
 * Retries once, then throws a TrackDownloadError.
 */
export async function cacheTrack(
  track: TrackData,
  attempts = 2,
): Promise<string> {
  // Bundled assets (require() → number) cannot be downloaded.
  const url = typeof track.url === "string" ? track.url : "";
  if (!url) throw new TrackDownloadError(track);
  // Already local (favourite downloaded for offline use, or an import).
  if (isLocal(url) && (await fileExists(url))) return url;

  const uri = trackCacheUri({ id: track.id, url });
  if (await fileExists(uri)) return uri;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (await downloadToFile(url, uri)) return uri;
      logger.warn("Track download returned an error status", {
        id: track.id,
        attempt,
      });
    } catch (e) {
      logger.warn("Track download failed", { id: track.id, attempt, error: e });
    }
  }
  throw new TrackDownloadError(track);
}

/**
 * Runs async tasks with a bounded concurrency, reporting progress after each
 * completion. Rejects on the first failure (remaining tasks are not started).
 * When `shouldContinue` turns false (session cancelled) no new task starts;
 * results of tasks already running are simply ignored by the caller.
 */
export async function runWithProgress<T>(
  tasks: (() => Promise<T>)[],
  onProgress: (done: number, total: number) => void,
  concurrency = 3,
  shouldContinue: () => boolean = () => true,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  let done = 0;
  let failed = false;
  onProgress(0, tasks.length);

  const worker = async () => {
    while (!failed && shouldContinue() && next < tasks.length) {
      const i = next++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        failed = true;
        throw e;
      }
      done += 1;
      onProgress(done, tasks.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}
