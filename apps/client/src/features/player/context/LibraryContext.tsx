import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as Sentry from "@sentry/react-native";
import { BACKEND_URL, DEBUG_PLAYER } from "../../../config";
import { useIsOnline } from "../../../hooks/useIsOnline";
import { usePlayerStore } from "../../../stores/player.store";
import { createLogger } from "../../../utils/logger";
import {
  getDownloadedSet,
  localTrackUri,
  syncFavoriteDownloads,
} from "../services/TrackOfflineService";
import { Track } from "../services/TrackRepository";
import { TrackData } from "./PlayerContext";
import { useTrackRepository } from "./TrackContext";

const logger = createLogger("LibraryContext");

export interface LibrarySection {
  title: string;
  data: TrackData[];
}

const LIBRARY_PAGE_SIZE = 30;

export interface LibraryContextType {
  sections: LibrarySection[];
  allTracks: TrackData[]; // Exposed for internal use (Performance Mode)
  groupBy: "default" | "style" | "artist";
  setGroupBy: (group: "default" | "style" | "artist") => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  reloadLibrary: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoadingMore: boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [rawTracks, setRawTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<TrackData[]>([]);

  const [groupBy, setGroupBy] = useState<"default" | "style" | "artist">(
    "default",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const trackRepo = useTrackRepository();

  // --- Musique hors-ligne (#416) : favoris téléchargés, le reste streamé ---
  const likedTrackIds = usePlayerStore((s) => s.likedTrackIds);
  const isOnline = useIsOnline();
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(
    new Set(),
  );

  // Réconciliation : en ligne → télécharge les favoris manquants, supprime
  // les ex-favoris ; hors ligne → recense juste ce qui est déjà sur disque.
  useEffect(() => {
    if (rawTracks.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const filenames = rawTracks.map((t) => t.filename);
      const next = isOnline
        ? await syncFavoriteDownloads(
            rawTracks.map((t) => ({
              filename: t.filename,
              remoteUrl: trackRepo.getTrackUrl(t.filename),
              liked: likedTrackIds.includes(String(t.id)),
            })),
          )
        : await getDownloadedSet(filenames);
      if (!cancelled) setDownloadedFilenames(next);
    };
    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rawTracks, likedTrackIds, isOnline, trackRepo]);

  const groupAndFilterTracks = useCallback(
    (tracks: TrackData[]): LibrarySection[] => {
      // 1. Filter first
      const filtered = tracks.filter((t) => {
        // Hide Ambiance from Library UI (by style or artist)
        const isAmbiance =
          t.style?.toLowerCase() === "ambiance" ||
          t.artist.toLowerCase() === "ambiance";

        if (isAmbiance) return false;

        const query = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query) ||
          (t.style?.toLowerCase().includes(query) ?? false) ||
          t.baseBpm.toString().includes(query)
        );
      });

      // 2. Group
      const groups: Partial<Record<string, TrackData[]>> = {};

      filtered.forEach((track) => {
        let key = "Tous les titres";

        if (groupBy === "style") {
          key = track.style ? track.style.toUpperCase() : "AUTRES";
        } else if (groupBy === "artist") {
          key = track.artist || "Inconnu";
        }

        groups[key] ??= [];
        groups[key]!.push(track);
      });

      // 3. Sort Sections
      const sectionKeys = Object.keys(groups).sort();

      return sectionKeys.map((key) => ({
        title: key,
        data: groups[key] ?? [],
      }));
    },
    [groupBy, searchQuery],
  );

  const loadLibrary = useCallback(async () => {
    try {
      Sentry.addBreadcrumb({
        category: "library",
        message: "Loading library",
        data: { backendUrl: BACKEND_URL ? "set" : "(vide)" },
      });
      const { tracks, hasMore: more } = await trackRepo.getTracksPage(
        0,
        LIBRARY_PAGE_SIZE,
      );
      setRawTracks(tracks);
      setHasMore(more);
      Sentry.addBreadcrumb({
        category: "library",
        message: "Library loaded",
        level: "info",
        data: { count: tracks.length, hasMore: more },
      });
      if (tracks.length === 0) {
        Sentry.captureMessage("Library empty (0 tracks from API)", "info");
      }
    } catch (e) {
      logger.error("Failed to load library from backend", e);
      Sentry.addBreadcrumb({
        category: "library",
        message: "Library load failed",
        level: "error",
        data: { error: e instanceof Error ? e.message : String(e) },
      });
      Sentry.captureException(e);
      setRawTracks([]);
      setAllTracks([]);
      setSections([]);
      setHasMore(false);
    }
  }, [trackRepo]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const { tracks, hasMore: more } = await trackRepo.getTracksPage(
        rawTracks.length,
        LIBRARY_PAGE_SIZE,
      );
      if (tracks.length > 0) {
        // Dédup par id : sur une liste courte, onEndReached peut déclencher
        // loadMore avec un `skip` périmé (rawTracks.length encore à 0) et
        // re-fetcher la page 0, ce qui doublait les pistes affichées.
        setRawTracks((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const fresh = tracks.filter((t) => !seen.has(t.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
      setHasMore(more);
    } catch (e) {
      logger.error("Failed to load more tracks", e);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [trackRepo, rawTracks.length, hasMore, isLoadingMore]);

  // Defer initial load: do NOT fetch on app mount (avoids /tracks call on Login screen and restores previous behavior).
  // The library is loaded when the user opens the Library tab (see useLibraryLogic useFocusEffect).

  // Re-compute sections whenever dependencies change
  useEffect(() => {
    if (rawTracks.length === 0) {
      setAllTracks([]);
      setSections([]);
      return;
    }
    try {
      // Map raw to TrackData first to have a common accessible list (guard against missing fields)
      const fullList: TrackData[] = rawTracks.map((track) => {
        // Copie locale (favori téléchargé ou import) → lecture hors-ligne ;
        // sinon streaming depuis le serveur (#416).
        const isDownloaded = downloadedFilenames.has(track.filename);
        return {
          id: String(track.id),
          title: String(track.title),
          artist: String(track.artist),
          url: isDownloaded
            ? localTrackUri(track.filename)
            : trackRepo.getTrackUrl(track.filename),
          baseBpm: track.bpm,
          style: track.style ?? "Importé",
          artwork: trackRepo.getArtworkUrl(track.artwork),
          playlist: "Tout",
          titleMasked: track.titleMasked ?? false,
          isDownloaded,
          clashTimecodes: track.clashTimecodes,
        };
      });
      if (DEBUG_PLAYER && fullList.length > 0) {
        const first = rawTracks[0];
        const built = fullList[0];
        logger.info("[Library] Debug first track", {
          rawFilename: first.filename,
          rawArtwork: first.artwork,
          computedUrl: built.url
            ? `${String(built.url).slice(0, 40)}...`
            : "(vide)",
          computedArtwork: built.artwork
            ? `${String(built.artwork).slice(0, 40)}...`
            : "(vide)",
        });
      }
      setAllTracks(fullList);

      const grouped = groupAndFilterTracks(fullList);
      setSections(grouped);
    } catch (e) {
      logger.error("Failed to build library sections", e);
      setAllTracks([]);
      setSections([]);
    }
  }, [rawTracks, trackRepo, groupAndFilterTracks, downloadedFilenames]);

  return (
    <LibraryContext.Provider
      value={{
        sections,
        allTracks,
        groupBy,
        setGroupBy,
        searchQuery,
        setSearchQuery,
        reloadLibrary: loadLibrary,
        loadMore,
        hasMore,
        isLoadingMore,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibrary must be used within a LibraryProvider");
  }
  return context;
};
