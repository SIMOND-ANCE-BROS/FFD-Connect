import { NavigationProp, useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { RootStackParamList } from "../../../navigation/types";
import {
  isLibraryStale,
  useLibrarySyncStore,
} from "../../../stores/librarySync.store";
import { createLogger } from "../../../utils/logger";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { TrackData, usePlayer } from "../context/PlayerContext";
import type { QueueAddResult } from "../utils/queueOps";

const logger = createLogger("useLibraryLogic");

interface UseLibraryLogicProps {
  navigation: NavigationProp<RootStackParamList>;
}

export const useLibraryLogic = ({ navigation }: UseLibraryLogicProps) => {
  const auth = useAuthRepository();
  const { playTrack, playNext, addToQueue, currentTrack, isPlaying, isLiked } =
    usePlayer();
  const {
    sections,
    allTracks,
    setGroupBy,
    searchQuery,
    setSearchQuery,
    reloadLibrary,
    loadMore,
    hasMore,
    isLoadingMore,
  } = useLibrary();

  const [isModalVisible, setModalVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState<{
    title: string;
    data: TrackData[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"default" | "style" | "likes">(
    "default",
  );
  const [addButtonOrigin, setAddButtonOrigin] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Load library when user opens the Library tab (deferred from app mount to avoid /tracks on Login screen).
  // Also reload a stale one (a track was corrected, or it is older than
  // LIBRARY_MAX_AGE_MS) so validated corrections show up without restarting.
  useFocusEffect(
    useCallback(() => {
      if (
        sections.length === 0 ||
        isLibraryStale(useLibrarySyncStore.getState(), Date.now())
      ) {
        reloadLibrary().catch(() => {});
      }
    }, [reloadLibrary, sections.length]),
  );

  // Apply the configured default filter ONCE, on first entry to the library.
  // Previously this ran on every focus, so returning from a track (or any
  // screen) reset the filter to the Settings default and lost the user's
  // current view. The ref makes it fire only the first time.
  const defaultFilterAppliedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (defaultFilterAppliedRef.current) return;
      const loadPref = async () => {
        try {
          const config = await auth.getAuthConfig();
          if (config.defaultLibraryFilter) {
            defaultFilterAppliedRef.current = true;
            setActiveTab(
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              config.defaultLibraryFilter as "default" | "style" | "likes",
            );
          }
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          logger.info(`[Library] Error loading preferences: ${error}`);
        }
      };
      loadPref().catch(() => {});
    }, [auth]),
  );

  // Sync GroupBy with Tab
  useEffect(() => {
    if (activeTab === "style") {
      setGroupBy("style");
    } else {
      setGroupBy("default");
    }
  }, [activeTab, setGroupBy]);

  // Reset selection only when the grouping tab changes. On garde la section
  // ouverte quand la recherche change → la barre reste visible ET filtre la
  // danse en cours (au lieu de sortir de la section).
  useEffect(() => {
    setSelectedSection(null);
  }, [activeTab]);

  // Filtre local (mêmes champs que LibraryContext) pour affiner une section
  // déjà ouverte selon la recherche courante.
  const matchesQuery = (track: TrackData): boolean => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      track.title.toLowerCase().includes(q) ||
      track.artist.toLowerCase().includes(q) ||
      (track.style?.toLowerCase().includes(q) ?? false) ||
      track.baseBpm.toString().includes(q)
    );
  };

  const getDisplayData = (): TrackData[] => {
    // Dans une danse ouverte : on garde ses titres mais on applique la recherche.
    if (selectedSection) return selectedSection.data.filter(matchesQuery);
    // `sections` est déjà filtré par la recherche (et masque Ambiance) dans
    // LibraryContext. On l'aplatit pour la vue liste au lieu de repartir de
    // `allTracks` (non filtré) — sinon la recherche ne filtre pas l'onglet Tout.
    const filtered = sections.flatMap((section) => section.data);
    if (activeTab === "likes") {
      return filtered.filter((track: TrackData) => isLiked(track.id));
    }
    return filtered;
  };

  const getPlaylistLabel = (): string => {
    if (activeTab === "likes") return "Favoris";
    if (activeTab === "style") {
      if (selectedSection?.title) return selectedSection.title;
      return "Danses";
    }
    return "Tout";
  };

  const handleTrackPress = (track: TrackData) => {
    logger.info(`[Library] Selected Track: ${track.title} (${track.id})`);
    const label = getPlaylistLabel();
    const contextTracks = getDisplayData().map((item) => ({
      ...item,
      playlist: label,
    }));
    playTrack({ ...track, playlist: label }, contextTracks).catch(() => {});
    navigation.navigate("AudioPlayer");
  };

  // Queue actions from the long-press sheet. A track keeps the playlist label
  // of the view it was picked from (shown on the player screen).
  const withPlaylist = (track: TrackData): TrackData => ({
    ...track,
    playlist: track.playlist ?? getPlaylistLabel(),
  });

  const handlePlayNext = (track: TrackData): Promise<QueueAddResult> => {
    logger.info(`[Library] Play next: ${track.title} (${track.id})`);
    return playNext(withPlaylist(track));
  };

  const handleAddToQueue = (track: TrackData): Promise<QueueAddResult> => {
    logger.info(`[Library] Add to queue: ${track.title} (${track.id})`);
    return addToQueue(withPlaylist(track));
  };

  const handleSectionPress = (section: {
    title: string;
    data: TrackData[];
  }) => {
    logger.info(`[Library] Opened Section: ${section.title}`);
    setSelectedSection(section);
  };

  const handleBackPress = () => {
    if (selectedSection) {
      logger.info("[Library] Back from Section");
      setSelectedSection(null);
    }
  };

  return {
    state: {
      isModalVisible,
      selectedSection,
      activeTab,
      addButtonOrigin,
      sections,
      allTracks,
      searchQuery,
      currentTrack,
      isPlaying,
      isLiked,
      displayData: getDisplayData(),
      hasMore,
      isLoadingMore,
    },
    actions: {
      setModalVisible,
      setSelectedSection,
      setActiveTab,
      setAddButtonOrigin,
      setSearchQuery,
      handleTrackPress,
      handlePlayNext,
      handleAddToQueue,
      handleSectionPress,
      handleBackPress,
      loadMore,
    },
  };
};
