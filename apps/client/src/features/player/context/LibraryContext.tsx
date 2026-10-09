import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Sentry from "@sentry/react-native";
import { BACKEND_URL, DEBUG_PLAYER } from "../../../config";
import { useIsOnline } from "../../../hooks/useIsOnline";
import { onSessionEnd } from "../../../services/sessionCleanup";
import { useAuthStore } from "../../../stores/auth.store";
import { useLibrarySyncStore } from "../../../stores/librarySync.store";
import { usePlayerStore } from "../../../stores/player.store";
import { createLogger } from "../../../utils/logger";
import {
  getDownloadedSet,
  syncFavoriteDownloads,
} from "../services/TrackOfflineService";
import { Track } from "../services/TrackRepository";
import { toTrackData } from "../services/trackMapping";
import { TrackData } from "./PlayerContext";
import { useTrackRepository } from "./TrackContext";

const logger = createLogger("LibraryContext");

export interface LibrarySection {
  title: string;
  data: TrackData[];
}

const LIBRARY_PAGE_SIZE = 30;
/** Backend cap on `take` for GET /tracks (PaginationParamsDto `@Max(100)`). */
const MAX_TRACKS_TAKE = 100;

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
  /**
   * True until the first library load has settled (success or failure). While
   * true the screen shows a single loader instead of the empty state, and no
   * "load more" page is requested.
   */
  isInitialLoading: boolean;
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
  // Lu par le chemin d'erreur de loadLibrary sans en faire une dépendance.
  const rawTracksRef = useRef<Track[]>([]);
  useEffect(() => {
    rawTracksRef.current = rawTracks;
  }, [rawTracks]);

  const [groupBy, setGroupBy] = useState<"default" | "style" | "artist">(
    "default",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // The first load is deferred to the Library tab's focus, so the library is
  // "initially loading" from mount until that first load settles: the screen
  // never flashes "Votre bibliothèque est vide" before the first response.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Bumped when a (re)load starts AND when it commits: a loadMore that was in
  // flight across a reload carries a stale generation and is dropped, instead
  // of appending its page after the freshly reloaded list (gap/duplicates).
  const generationRef = useRef(0);
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
    // Version du signal de fraîcheur AVANT la requête : une piste modifiée
    // pendant le chargement laisse la bibliothèque périmée (rechargée ensuite).
    const version = useLibrarySyncStore.getState().version;
    generationRef.current += 1;
    const generation = generationRef.current;
    try {
      Sentry.addBreadcrumb({
        category: "library",
        message: "Loading library",
        data: { backendUrl: BACKEND_URL ? "set" : "(vide)" },
      });
      // Background refresh of an already scrolled list: re-fetch everything
      // already shown (not just page 0) so the list doesn't collapse under the
      // user. The backend caps `take`, so fetch successive chunks.
      const target = Math.max(LIBRARY_PAGE_SIZE, rawTracksRef.current.length);
      const tracks: Track[] = [];
      const seen = new Set<Track["id"]>();
      let more = true;
      while (more && tracks.length < target) {
        const page = await trackRepo.getTracksPage(
          tracks.length,
          Math.min(MAX_TRACKS_TAKE, target - tracks.length),
        );
        more = page.hasMore;
        const fresh = page.tracks.filter((t) => !seen.has(t.id));
        if (fresh.length === 0) break;
        fresh.forEach((t) => seen.add(t.id));
        tracks.push(...fresh);
      }
      // A newer reload superseded this one: let it win.
      if (generation !== generationRef.current) return;
      generationRef.current += 1;
      setRawTracks(tracks);
      setHasMore(more);
      setHasLoadedOnce(true);
      useLibrarySyncStore.getState().markLoaded(version);
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
      if (generation !== generationRef.current) return;
      setHasLoadedOnce(true);
      // Rafraîchissement d'une bibliothèque déjà affichée : on garde la liste
      // plutôt que de la vider sur un échec réseau passager.
      if (rawTracksRef.current.length > 0) return;
      setRawTracks([]);
      setAllTracks([]);
      setSections([]);
      setHasMore(false);
    }
  }, [trackRepo]);

  const loadMore = useCallback(async () => {
    // No "load more" before the first page landed: on an empty list
    // onEndReached fires on layout, which used to show the "Chargement…"
    // footer on top of the empty state during the first load.
    if (!hasLoadedOnce || !hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    const generation = generationRef.current;
    try {
      const { tracks, hasMore: more } = await trackRepo.getTracksPage(
        rawTracks.length,
        LIBRARY_PAGE_SIZE,
      );
      // The list was reloaded while this page was in flight: its offset no
      // longer matches the current list, drop it.
      if (generation !== generationRef.current) return;
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
      if (generation === generationRef.current) setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [trackRepo, rawTracks.length, hasMore, isLoadingMore, hasLoadedOnce]);

  // Session over (logout, or the refresh token expired): forget the library
  // and its "already loaded" flag, so the next user gets the initial loader
  // again instead of a flash of "Votre bibliothèque est vide". Bumping the
  // generation drops any load still in flight for the previous session.
  const resetLibrary = useCallback(() => {
    generationRef.current += 1;
    setRawTracks([]);
    setHasMore(true);
    setHasLoadedOnce(false);
  }, []);
  useEffect(() => onSessionEnd(resetLibrary), [resetLibrary]);
  // The expired-refresh-token path doesn't run the session-end cleanups (they
  // also run on the biometric lock): catch it through the auth store.
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  useEffect(() => {
    if (isLoggedIn === false) resetLibrary();
  }, [isLoggedIn, resetLibrary]);

  // Une piste a changé (proposition validée, clashs édités) : recharge en
  // arrière-plan une bibliothèque DÉJÀ chargée. Jamais chargée → rien (le
  // premier chargement reste différé à l'ouverture de l'onglet).
  const staleVersion = useLibrarySyncStore((s) => s.version);
  useEffect(() => {
    const { loadedAt, loadedVersion } = useLibrarySyncStore.getState();
    if (loadedAt === 0 || staleVersion <= loadedVersion) return;
    loadLibrary().catch(() => {});
  }, [staleVersion, loadLibrary]);

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
      const fullList: TrackData[] = rawTracks.map((track) =>
        // Copie locale (favori téléchargé ou import) → lecture hors-ligne ;
        // sinon streaming depuis le serveur (#416).
        toTrackData(track, trackRepo, downloadedFilenames.has(track.filename)),
      );
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
        isInitialLoading: !hasLoadedOnce,
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
