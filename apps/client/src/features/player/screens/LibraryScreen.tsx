import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SlidersHorizontal, Trophy } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  FlatList,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { NotificationBell } from "../../../components/NotificationBell";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { BackendService } from "../../../services/BackendService";
import { useAuthStore } from "../../../stores/auth.store";
import { logger } from "../../../utils/logger";
import { SearchBar } from "../../../components/SearchBar";
import { FilterSheet } from "../../../components/FilterSheet";
import { FilterChip } from "../../../components/FilterChip";
import { AddTrackModal, type EditableTrack } from "../components/AddTrackModal";
import { ReportTrackModal } from "../components/ReportTrackModal";
import { DANCE_GROUPS } from "../utils/danceTempo";
import {
  LibraryEmptyState,
  LibraryGridItem,
  LibraryTrackItem,
} from "../components/library";
import { libraryStyles as styles } from "../components/library/library.styles";
import { TrackData } from "../context/PlayerContext";
import { useLibraryLogic } from "../hooks/useLibraryLogic";

type LibraryScreenProps = NativeStackScreenProps<RootStackParamList, "Library">;

export const LibraryScreen = ({ navigation }: LibraryScreenProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  // Hauteur mesurée de l'en-tête épinglé (titre + recherche + onglets) pour
  // caler le paddingTop de la liste. Estimation initiale avant onLayout.
  const [headerH, setHeaderH] = useState(insets.top + 170);
  const { role, isGuest } = useAuthStore();
  const isAdmin = role === "ADMIN";
  const [editTrack, setEditTrack] = useState<EditableTrack | null>(null);
  // Signalement (non-admins) : piste ciblée + visibilité de la modale.
  const [reportTrack, setReportTrack] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const { state, actions } = useLibraryLogic({ navigation });

  const {
    isModalVisible,
    selectedSection,
    activeTab,
    sections,
    searchQuery,
    currentTrack,
    isPlaying,
    displayData,
    hasMore,
    isLoadingMore,
  } = state;

  const {
    setModalVisible,
    setActiveTab,
    setSearchQuery,
    handleTrackPress,
    handleSectionPress,
    handleBackPress,
    loadMore,
  } = actions;

  // --- Filtres avancés (style de danse + plage MPM) ---
  const [filterVisible, setFilterVisible] = useState(false);
  const [styleFilter, setStyleFilter] = useState<Set<string>>(new Set());
  const [mpmMin, setMpmMin] = useState("");
  const [mpmMax, setMpmMax] = useState("");

  const activeFilterCount =
    styleFilter.size + (mpmMin ? 1 : 0) + (mpmMax ? 1 : 0);

  const toggleStyle = (dance: string) => {
    setStyleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(dance)) next.delete(dance);
      else next.add(dance);
      return next;
    });
  };

  const resetFilters = () => {
    setStyleFilter(new Set());
    setMpmMin("");
    setMpmMax("");
  };

  const matchesFilter = useCallback(
    (track: TrackData): boolean => {
      if (
        styleFilter.size > 0 &&
        !(track.style && styleFilter.has(track.style))
      )
        return false;
      const bpm = track.baseBpm ?? 0;
      const min = parseInt(mpmMin, 10);
      if (mpmMin && Number.isFinite(min) && bpm < min) return false;
      const max = parseInt(mpmMax, 10);
      if (mpmMax && Number.isFinite(max) && bpm > max) return false;
      return true;
    },
    [styleFilter, mpmMin, mpmMax],
  );

  const filteredDisplayData = useMemo(
    () =>
      activeFilterCount === 0 ? displayData : displayData.filter(matchesFilter),
    [displayData, matchesFilter, activeFilterCount],
  );
  const filteredSections = useMemo(() => {
    if (activeFilterCount === 0) return sections;
    return sections
      .map((s) => ({ ...s, data: s.data.filter(matchesFilter) }))
      .filter((s) => s.data.length > 0);
  }, [sections, matchesFilter, activeFilterCount]);

  // Long-press behaviour depends on the role:
  //  • Admins edit the track's metadata (dance, MPM…). Fetches the full track
  //    (rawBpm, filename) before opening the edit modal.
  //  • Everyone else reports a problem on the track (→ notifies the admins).
  const handleTrackLongPress = useCallback(
    async (item: TrackData) => {
      if (!isAdmin) {
        setReportTrack({ id: item.id, title: item.title });
        setReportVisible(true);
        return;
      }
      try {
        const track = await BackendService.getTrack(item.id);
        setEditTrack({
          id: track.id,
          title: track.title,
          artist: track.artist,
          bpm: track.bpm,
          rawBpm: track.rawBpm,
          style: track.style,
          filename: track.filename,
        });
        setModalVisible(true);
      } catch (error) {
        logger.warn("[Library] Failed to load track for edit", error);
      }
    },
    [isAdmin, setModalVisible],
  );

  const bar1 = useRef(new Animated.Value(8)).current;
  const bar2 = useRef(new Animated.Value(12)).current;
  const bar3 = useRef(new Animated.Value(6)).current;
  const equalizerAnimation = useRef<Animated.CompositeAnimation | null>(null);

  // Equalizer Animation (Purely UI)
  useEffect(() => {
    equalizerAnimation.current?.stop();

    if (currentTrack && isPlaying) {
      const bar1Loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bar1, {
            toValue: 14,
            duration: 220,
            useNativeDriver: false,
          }),
          Animated.timing(bar1, {
            toValue: 8,
            duration: 220,
            useNativeDriver: false,
          }),
        ]),
      );
      const bar2Loop = Animated.loop(
        Animated.sequence([
          Animated.delay(70),
          Animated.timing(bar2, {
            toValue: 18,
            duration: 220,
            useNativeDriver: false,
          }),
          Animated.timing(bar2, {
            toValue: 12,
            duration: 220,
            useNativeDriver: false,
          }),
        ]),
      );
      const bar3Loop = Animated.loop(
        Animated.sequence([
          Animated.delay(140),
          Animated.timing(bar3, {
            toValue: 12,
            duration: 220,
            useNativeDriver: false,
          }),
          Animated.timing(bar3, {
            toValue: 6,
            duration: 220,
            useNativeDriver: false,
          }),
        ]),
      );

      equalizerAnimation.current = Animated.parallel(
        [bar1Loop, bar2Loop, bar3Loop],
        { stopTogether: false },
      );
      equalizerAnimation.current.start();
    } else {
      bar1.setValue(8);
      bar2.setValue(12);
      bar3.setValue(6);
    }

    return () => {
      equalizerAnimation.current?.stop();
    };
  }, [currentTrack, isPlaying, bar1, bar2, bar3]);

  const renderTrackItem = useCallback(
    ({ item }: { item: TrackData }) => (
      <LibraryTrackItem
        item={item}
        currentTheme={currentTheme}
        isDark={isDark}
        isCurrent={currentTrack?.id === item.id}
        isPlaying={isPlaying}
        bar1={bar1}
        bar2={bar2}
        bar3={bar3}
        onPress={handleTrackPress}
        onLongPress={(track) => void handleTrackLongPress(track)}
      />
    ),
    [
      currentTheme,
      isDark,
      currentTrack,
      isPlaying,
      handleTrackLongPress,
      bar1,
      bar2,
      bar3,
      handleTrackPress,
    ],
  );

  const renderGridItem = useCallback(
    ({ item }: { item: { title: string; data: TrackData[] } }) => (
      <LibraryGridItem
        item={item}
        currentTheme={currentTheme}
        isDark={isDark}
        onPress={handleSectionPress}
      />
    ),
    [currentTheme, isDark, handleSectionPress],
  );

  const isGridView = activeTab === "style" && !searchQuery && !selectedSection;

  const handleEndReached = () => {
    if (hasMore && !isLoadingMore) {
      loadMore().catch(() => {});
    }
  };

  const renderListFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <AppText variant="caption" color={currentTheme.textSecondary}>
          Chargement…
        </AppText>
      </View>
    );
  };

  const renderEmptyComponent = () => (
    <LibraryEmptyState
      currentTheme={currentTheme}
      activeTab={activeTab}
      searchQuery={searchQuery}
    />
  );

  const pinnedContent = (
    <>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher titre, artiste, danse ou MPM…"
        testID="library-search"
      />

      <View style={styles.tabsContainer}>
        <FluidSegmentedTab
          activeValue={activeTab}
          onChange={(val) => {
            logger.info(`[Library] Changed Filter: ${val}`);
            setActiveTab(val as "default" | "style" | "likes");
          }}
          options={[
            { label: "Tout", value: "default" },
            { label: "Danses", value: "style" },
            { label: "Favoris", value: "likes" },
          ]}
        />
      </View>
    </>
  );

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      {isGridView ? (
        <FlatList
          key="grid"
          data={filteredSections}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.title}
          numColumns={2}
          contentContainerStyle={[
            styles.gridListContent,
            { paddingTop: headerH + 8 },
          ]}
          columnWrapperStyle={
            filteredSections.length > 0 ? styles.columnWrapper : undefined
          }
          ListEmptyComponent={renderEmptyComponent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderListFooter}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          key="list"
          data={filteredDisplayData}
          renderItem={renderTrackItem}
          keyExtractor={(item) => item.id}
          numColumns={1}
          contentContainerStyle={[
            styles.trackList,
            { paddingTop: headerH + 8 },
          ]}
          ListEmptyComponent={renderEmptyComponent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderListFooter}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* En-tête verre FIXE (titre + recherche + onglets épinglés) ;
          la liste défile dessous. */}
      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title={selectedSection ? selectedSection.title : "Bibliothèque"}
        onHeightChange={setHeaderH}
        left={
          selectedSection ? <BackButton onPress={handleBackPress} /> : undefined
        }
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Filtres"
              accessibilityHint="Filtrer par style de danse et cadence"
              testID="library-filter-button"
              onPress={() => setFilterVisible(true)}
              style={[
                styles.headerActionButton,
                isDark
                  ? styles.headerActionButtonDark
                  : styles.headerActionButtonLight,
                {
                  borderColor:
                    activeFilterCount > 0
                      ? currentTheme.primary
                      : currentTheme.border,
                },
              ]}
            >
              <SlidersHorizontal
                color={
                  activeFilterCount > 0
                    ? currentTheme.primary
                    : currentTheme.text
                }
                size={20}
              />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID="library-performance-button"
              onPress={() => navigation.navigate("PerformanceSetup")}
              style={[
                styles.headerActionButton,
                isDark
                  ? styles.headerActionButtonDark
                  : styles.headerActionButtonLight,
                { borderColor: currentTheme.border },
              ]}
            >
              <Trophy color="#FFD700" size={22} />
            </TouchableOpacity>
            {!isGuest && (
              <NotificationBell
                theme={currentTheme}
                isDark={isDark}
                enabled={!isGuest}
                onPress={() => navigation.navigate("Notifications")}
              />
            )}
          </View>
        }
      >
        {pinnedContent}
      </PinnedHeader>

      <AddTrackModal
        visible={isModalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditTrack(null);
        }}
        editTrack={editTrack}
      />

      <ReportTrackModal
        visible={reportVisible}
        onClose={() => {
          setReportVisible(false);
          setReportTrack(null);
        }}
        track={reportTrack}
      />

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        onReset={resetFilters}
        title="Filtrer la bibliothèque"
        activeCount={activeFilterCount}
      >
        <AppText
          variant="button"
          color={currentTheme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Style de danse
        </AppText>
        {/* Séparé en 2 catégories (Latine / Standard) comme en compétition. */}
        {DANCE_GROUPS.map((group) => (
          <View key={group.label}>
            <AppText
              variant="caption"
              color={currentTheme.textSecondary}
              style={styles.filterGroupLabel}
            >
              {group.label === "Latin" ? "Latine" : group.label}
            </AppText>
            <View style={styles.filterChips}>
              {group.dances.map((dance) => (
                <FilterChip
                  key={dance}
                  label={dance}
                  selected={styleFilter.has(dance)}
                  onPress={() => toggleStyle(dance)}
                  testID={`library-filter-style-${dance}`}
                />
              ))}
            </View>
          </View>
        ))}

        <AppText
          variant="button"
          color={currentTheme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Cadence (MPM)
        </AppText>
        <View style={styles.filterMpmRow}>
          <TextInput
            style={[
              styles.filterMpmInput,
              {
                color: currentTheme.text,
                borderColor: currentTheme.border,
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
              },
            ]}
            value={mpmMin}
            onChangeText={setMpmMin}
            keyboardType="numeric"
            placeholder="Min"
            placeholderTextColor={currentTheme.textSecondary}
            accessibilityLabel="MPM minimum"
            accessibilityHint="Cadence minimale à afficher"
            testID="library-filter-mpm-min"
          />
          <AppText variant="body" color={currentTheme.textSecondary}>
            –
          </AppText>
          <TextInput
            style={[
              styles.filterMpmInput,
              {
                color: currentTheme.text,
                borderColor: currentTheme.border,
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
              },
            ]}
            value={mpmMax}
            onChangeText={setMpmMax}
            keyboardType="numeric"
            placeholder="Max"
            placeholderTextColor={currentTheme.textSecondary}
            accessibilityLabel="MPM maximum"
            accessibilityHint="Cadence maximale à afficher"
            testID="library-filter-mpm-max"
          />
        </View>
      </FilterSheet>
    </SafeAreaView>
  );
};
