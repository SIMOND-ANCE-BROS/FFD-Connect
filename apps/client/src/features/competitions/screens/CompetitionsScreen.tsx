import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { CompositeScreenProps } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList } from "@shopify/flash-list";
import {
  Calendar,
  Clock,
  MapPin,
  SlidersHorizontal,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BetaNotice } from "../../../components/BetaNotice";
import { BETA_NOTICES } from "../../../constants/betaNotices";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { NotificationBell } from "../../../components/NotificationBell";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { SearchBar } from "../../../components/SearchBar";
import { FilterSheet } from "../../../components/FilterSheet";
import { FilterChip } from "../../../components/FilterChip";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { useWakeStore } from "../../../stores/wake.store";
import { Competition } from "../context/CompetitionContext";
import {
  CompetitionDatePeriod,
  CompetitionDiscipline,
  CompetitionStatusFilter,
  CompetitionStyle,
  toCompetitionScope,
  toCompetitionStatusFilter,
  useCompetitionsLogic,
} from "../hooks/useCompetitionsLogic";
import {
  deadlineLabel,
  formatParisDate,
  formatParisTime,
  getDeadlineDays,
  getEffectiveCompetitionStatus,
  shouldShowParisLabel,
} from "../utils/competitionCard";
import { styles } from "./CompetitionsScreen.styles";

/**
 * Calcule la distance en km entre deux coordonnées GPS (formule de Haversine).
 */
function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // rayon de la Terre en km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formate une distance en texte lisible : "~350 m" si < 1 km, "~12 km" sinon.
 */
function formatDistance(km: number): string {
  if (km < 1) {
    return `~${Math.round(km * 1000)} m`;
  }
  return `~${Math.round(km)} km`;
}

type Props = CompositeScreenProps<
  BottomTabScreenProps<RootStackParamList, "Competitions">,
  NativeStackScreenProps<RootStackParamList>
>;

export const CompetitionsScreen = ({ navigation }: Props) => {
  const { state, actions } = useCompetitionsLogic();
  const {
    competitions,
    refreshing,
    isLoading,
    isLoadingMore,
    canLoadMoreManually,
    scope,
    statusFilter,
    searchQuery,
    theme,
    role,
    userLocation,
    maxDistanceKm,
    datePeriod,
    dateFrom,
    dateTo,
    styleFilter,
    disciplineFilter,
  } = state;
  const {
    setScope,
    setStatusFilter,
    setSearchQuery,
    setMaxDistanceKm,
    setDatePeriod,
    setDateFrom,
    setDateTo,
    setStyleFilter,
    setDisciplineFilter,
    onRefresh,
    onLoadMore,
    loadSettings,
  } = actions;
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const wakeOverlayVisible = useWakeStore((s) => s.waking && s.visible);

  // Feuille de filtres avancés (discipline + style + distance + période)
  const [filterVisible, setFilterVisible] = useState(false);
  // Saisie distance perso (km) + quel champ date le calendrier édite.
  const [customKm, setCustomKm] = useState("");
  const [pickerFor, setPickerFor] = useState<null | "from" | "to">(null);
  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR") : "—");
  const activeFilterCount =
    (maxDistanceKm !== null ? 1 : 0) +
    (datePeriod !== "ALL" ? 1 : 0) +
    (dateFrom !== null || dateTo !== null ? 1 : 0) +
    styleFilter.size +
    disciplineFilter.size;
  const resetFilters = () => {
    setMaxDistanceKm(null);
    setDatePeriod("ALL");
    setDateFrom(null);
    setDateTo(null);
    setStyleFilter(new Set());
    setDisciplineFilter(new Set());
    setCustomKm("");
    setPickerFor(null);
  };
  const toggleStyle = (s: CompetitionStyle) =>
    setStyleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const toggleDiscipline = (d: CompetitionDiscipline) =>
    setDisciplineFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  // Hauteur mesurée de l'en-tête épinglé (titre + recherche + filtres) pour
  // caler le paddingTop de la liste. Estimation initiale avant onLayout.
  const [headerH, setHeaderH] = useState(insets.top + 170);

  // Reset filters only when user explicitly toggles the tab (navigation via navbar)
  React.useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadSettings().catch(() => {});
    });
    return unsubscribe;
  }, [navigation, loadSettings]);

  // Filtre de scope : licencié = Toutes/Pour moi ; club = Toutes/Les nôtres ;
  // admin & staff = pas de scope (ils voient tout), on masque le filtre.
  const showScopeTabs = role === "LICENSEE" || role === "CLUB";
  const renderScopeTabs = () => (
    <View style={styles.fluidTabWrapper}>
      <FluidSegmentedTab
        activeValue={scope}
        onChange={(val: string) => setScope(toCompetitionScope(val))}
        options={[
          { label: "Toutes", value: "ALL" },
          {
            label: role === "CLUB" ? "Les nôtres" : "Pour moi",
            value: "FOR_ME",
          },
        ]}
      />
    </View>
  );

  // Render Status Filter Chips
  // ... (Status Filters Logic)
  const renderStatusFilters = () => {
    const filters: { label: string; value: CompetitionStatusFilter }[] = [
      { label: "À venir", value: "UPCOMING" },
      { label: "En cours", value: "LIVE" },
      { label: "Passées", value: "PAST" },
      { label: "Tout", value: "ALL" },
    ];

    return (
      <View style={styles.tabWrapper}>
        <FluidSegmentedTab
          activeValue={statusFilter}
          onChange={(val: string) =>
            setStatusFilter(toCompetitionStatusFilter(val))
          }
          options={filters}
        />
      </View>
    );
  };

  const competitionsWithMembersCount =
    role === "CLUB"
      ? competitions.filter((c) => (c.clubMembersRegisteredCount ?? 0) > 0)
          .length
      : 0;

  const showParisLabel = useMemo(() => shouldShowParisLabel(), []);

  const renderItem = ({ item }: { item: Competition }) => {
    // Statut EFFECTIF dérivé de la date (même source de vérité que le filtre) :
    // le `status` stocké peut être périmé (passé laissé en UPCOMING).
    const effectiveStatus = getEffectiveCompetitionStatus(
      item.status,
      item.date,
    );
    return (
      <TouchableOpacity
        testID={`competition-card-${item.id}`}
        accessibilityLabel={`Détails de la compétition ${item.title}`}
        accessibilityHint={`Ouvrir les détails de la compétition ${item.title}`}
        accessible
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
        onPress={() =>
          navigation.navigate("CompetitionDetail", { competitionId: item.id })
        }
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <AppText variant="h3" style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </AppText>
          <View style={styles.cardRightColumn}>
            {role === "CLUB" && item.isOrganizedByMyClub && (
              <View
                style={[
                  styles.badgeMargin,
                  styles.organizerBadge,
                  { borderColor: theme.primary },
                ]}
              >
                <AppText
                  variant="caption"
                  weight="600"
                  color={theme.primary}
                  style={styles.organizerBadgeText}
                >
                  J'organise
                </AppText>
              </View>
            )}
            <StatusBadge status={effectiveStatus} />
            {effectiveStatus === "UPCOMING" &&
              !state.isGuest &&
              role !== "CLUB" && (
                <View style={styles.badgeMargin}>
                  {item.isRegistered ? (
                    <AppText
                      variant="caption"
                      weight="600"
                      color={theme.success}
                    >
                      Inscrit
                    </AppText>
                  ) : !item.isEligible ? (
                    <AppText
                      variant="caption"
                      weight="600"
                      color={theme.textSecondary}
                    >
                      Inéligible
                    </AppText>
                  ) : (
                    <AppText
                      variant="caption"
                      weight="600"
                      color={theme.textSecondary}
                    >
                      Non inscrit
                    </AppText>
                  )}
                </View>
              )}
          </View>
        </View>

        {/* ── Two-state card body: UPCOMING vs LIVE vs PAST ── */}
        {effectiveStatus === "LIVE" ? (
          <>
            {/* Day-of: venue address + time prominently */}
            <View style={styles.cardLocationContainer}>
              <MapPin size={16} color={theme.primary} />
              <AppText
                variant="body"
                weight="600"
                color={theme.text}
                style={styles.cardLocation}
              >
                {item.address ?? item.location}
              </AppText>
            </View>
            <View style={[styles.cardDateContainer, styles.liveTimeRow]}>
              <Clock size={14} color={theme.primary} />
              <AppText
                variant="body"
                weight="600"
                color={theme.primary}
                style={styles.cardDate}
              >
                {formatParisTime(item.date)}
                {showParisLabel ? " (heure de Paris)" : ""}
              </AppText>
            </View>
            {userLocation &&
              item.latitude != null &&
              item.longitude != null && (
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  style={styles.distanceText}
                >
                  {formatDistance(
                    getDistanceKm(
                      userLocation.latitude,
                      userLocation.longitude,
                      item.latitude,
                      item.longitude,
                    ),
                  )}
                </AppText>
              )}
          </>
        ) : (
          <>
            {/* UPCOMING / PAST: date + deadline + location + distance */}
            <View style={styles.cardDateContainer}>
              <Calendar size={16} color={theme.textSecondary} />
              <AppText
                variant="body"
                color={theme.textSecondary}
                style={styles.cardDate}
              >
                {formatParisDate(item.date)}
              </AppText>
            </View>

            {effectiveStatus === "UPCOMING" &&
              (() => {
                const days = getDeadlineDays(item.registrationDeadline);
                if (days === null) return null;
                return (
                  <View style={styles.deadlineContainer}>
                    <Clock
                      size={14}
                      color={days <= 3 ? theme.danger : theme.warning}
                    />
                    <AppText
                      variant="caption"
                      weight="bold"
                      color={days <= 3 ? theme.danger : theme.warning}
                      style={styles.deadlineText}
                    >
                      {deadlineLabel(days)}
                    </AppText>
                  </View>
                );
              })()}

            <View style={styles.cardLocationContainer}>
              <MapPin size={16} color={theme.textSecondary} />
              <AppText
                variant="body"
                color={theme.textSecondary}
                style={styles.cardLocation}
              >
                {item.location}
              </AppText>
            </View>

            {effectiveStatus === "UPCOMING" &&
              userLocation &&
              item.latitude != null &&
              item.longitude != null && (
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  style={styles.distanceText}
                >
                  {formatDistance(
                    getDistanceKm(
                      userLocation.latitude,
                      userLocation.longitude,
                      item.latitude,
                      item.longitude,
                    ),
                  )}
                </AppText>
              )}
          </>
        )}

        {role === "CLUB" && (item.clubMembersRegisteredCount ?? 0) > 0 && (
          <View style={[styles.cardLocationContainer, styles.clubMembersRow]}>
            <AppText
              variant="caption"
              weight="600"
              color={theme.primary}
              style={styles.clubMembersText}
            >
              {item.clubMembersRegisteredCount} membre(s) du club inscrit(s)
            </AppText>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const getEmptyMessage = () => {
    // Club « Les nôtres » = compétitions organisées par le club, PAS des
    // inscriptions personnelles → message dédié (l'ancien parlait d'inscription).
    if (scope === "FOR_ME" && role === "CLUB") {
      return {
        title: "Aucune compétition",
        subtitle: "Votre club n'organise aucune compétition pour ce filtre.",
      };
    }
    if (scope === "FOR_ME") {
      // « Pour moi » = compétitions où vous êtes éligible ou déjà inscrit
      // (pas seulement vos inscriptions) → formulation orientée éligibilité.
      switch (statusFilter) {
        case "UPCOMING":
          return {
            title: "Rien pour vous",
            subtitle:
              "Aucune compétition à venir ne correspond à votre profil.",
          };
        case "LIVE":
          return {
            title: "Aucun direct",
            subtitle:
              "Aucune compétition en cours ne correspond à votre profil.",
          };
        case "PAST":
          return {
            title: "Historique vide",
            subtitle: "Aucune compétition passée ne correspond à votre profil.",
          };
        default:
          return {
            title: "Rien pour vous",
            subtitle: "Aucune compétition ne correspond à votre profil.",
          };
      }
    } else {
      switch (statusFilter) {
        case "UPCOMING":
          return {
            title: "Aucune compétition",
            subtitle: "Aucune compétition à venir n'est prévue.",
          };
        case "LIVE":
          return {
            title: "Aucun direct",
            subtitle: "Aucune compétition n'est en cours actuellement.",
          };
        case "PAST":
          return {
            title: "Historique vide",
            subtitle: "Aucune compétition passée trouvée.",
          };
        default:
          return {
            title: "Aucun résultat",
            subtitle: "Aucune compétition ne correspond à vos critères.",
          };
      }
    }
  };

  const emptyState = getEmptyMessage();

  const pinnedFilters = (
    <>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher une compétition…"
        testID="competitions-search"
      />
      <View style={styles.listHeaderTabs}>
        {!state.isGuest && showScopeTabs && renderScopeTabs()}
        {renderStatusFilters()}
        {role === "CLUB" && competitionsWithMembersCount > 0 && (
          <View style={styles.organizerCounterRow}>
            <AppText
              variant="body"
              color={theme.textSecondary}
              style={styles.organizerCounterText}
            >
              {competitionsWithMembersCount} compétition(s) avec des membres
              inscrits
            </AppText>
          </View>
        )}
      </View>
    </>
  );

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <StatusBar barStyle={theme.dark ? "light-content" : "dark-content"} />

      <View style={styles.container}>
        {/* Single full-screen loader; hidden while the wake overlay (which
            has its own spinner) is up, so only one spinner is ever on screen. */}
        {isLoading && !wakeOverlayVisible ? (
          <View
            testID="competitions-loading"
            style={[styles.emptyContainer, { paddingTop: headerH }]}
          >
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : null}

        <FlashList
          data={competitions}
          keyExtractor={(item: Competition) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              progressViewOffset={headerH}
              onRefresh={() => {
                onRefresh().catch(() => {});
              }}
              tintColor={theme.primary}
            />
          }
          onEndReached={() => {
            // onLoadMore renews the auto-fetch budget: only a real scroll to
            // the end of a non-empty list may do that. An empty list can fire
            // onEndReached on layout, which would re-open unbounded fetching.
            if (competitions.length === 0) return;
            onLoadMore().catch(() => {});
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            <ListFooter
              isLoadingMore={isLoadingMore}
              // In the empty state the button lives there instead.
              canLoadMore={canLoadMoreManually && competitions.length > 0}
              onLoadMore={onLoadMore}
            />
          }
          // headerH already includes the header's fade tail (and the filters
          // keep their own bottom margin): no extra offset on top of it.
          contentContainerStyle={{
            ...styles.listContent,
            paddingTop: headerH,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            // Beta: competitions are informative only, the app is not
            // connected to the federation registrations yet.
            <BetaNotice
              title={BETA_NOTICES.competitions.title}
              message={BETA_NOTICES.competitions.message}
              style={styles.betaNotice}
              testID="competitions-beta-notice"
            />
          }
          ListEmptyComponent={
            // While pages may still hold matches, the loader above is shown
            // instead of a premature "no competition" message.
            isLoading ? null : (
              <View style={styles.emptyContainer}>
                <AppText
                  variant="h3"
                  align="center"
                  style={{ color: theme.text }}
                >
                  {emptyState.title}
                </AppText>
                <AppText
                  variant="body"
                  align="center"
                  style={[styles.emptySubtitle, { color: theme.textSecondary }]}
                >
                  {emptyState.subtitle}
                </AppText>
                {scope === "FOR_ME" && role !== "CLUB" ? (
                  <AppText
                    variant="caption"
                    align="center"
                    style={[
                      styles.emptySubtitle,
                      { color: theme.textSecondary },
                    ]}
                    testID="competitions-empty-beta-hint"
                  >
                    {BETA_NOTICES.competitionsEmptyHint}
                  </AppText>
                ) : null}
                {canLoadMoreManually ? (
                  <LoadMoreButton onLoadMore={onLoadMore} />
                ) : null}
              </View>
            )
          }
        />

        {/* En-tête verre FIXE (titre + cloche + recherche + filtres épinglés) ;
            la liste défile dessous. */}
        <PinnedHeader
          theme={theme}
          isDark={isDark}
          title="Compétitions"
          onHeightChange={setHeaderH}
          right={
            <View style={styles.headerActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Filtres"
                accessibilityHint="Filtrer par distance et période"
                testID="competitions-filter-button"
                onPress={() => setFilterVisible(true)}
                style={[
                  styles.headerActionButton,
                  {
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.05)"
                      : "#F5F5F5",
                    borderColor:
                      activeFilterCount > 0 ? theme.primary : theme.border,
                  },
                ]}
              >
                <SlidersHorizontal
                  color={activeFilterCount > 0 ? theme.primary : theme.text}
                  size={20}
                />
              </TouchableOpacity>
              {!state.isGuest && (
                <NotificationBell
                  theme={theme}
                  isDark={isDark}
                  enabled={!state.isGuest}
                  onPress={() => navigation.navigate("Notifications")}
                />
              )}
            </View>
          }
        >
          {pinnedFilters}
        </PinnedHeader>
      </View>

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        onReset={resetFilters}
        title="Filtrer les compétitions"
        activeCount={activeFilterCount}
      >
        {/* Discipline (Couple / Solo / Solo Team) */}
        <AppText
          variant="button"
          color={theme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Discipline
        </AppText>
        <View style={styles.filterChips}>
          {(
            [
              { label: "Couple", value: "COUPLE" },
              { label: "Solo", value: "SOLO" },
              { label: "Solo Team", value: "SOLO_TEAM" },
            ] as const satisfies {
              label: string;
              value: CompetitionDiscipline;
            }[]
          ).map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              selected={disciplineFilter.has(opt.value)}
              onPress={() => toggleDiscipline(opt.value)}
              testID={`competitions-filter-discipline-${opt.value}`}
            />
          ))}
        </View>

        {/* Style de danse (Latine / Standard) */}
        <AppText
          variant="button"
          color={theme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Style de danse
        </AppText>
        <View style={styles.filterChips}>
          {(
            [
              { label: "Latine", value: "Latin" },
              { label: "Standard", value: "Standard" },
            ] as const satisfies { label: string; value: CompetitionStyle }[]
          ).map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              selected={styleFilter.has(opt.value)}
              onPress={() => toggleStyle(opt.value)}
              testID={`competitions-filter-style-${opt.value}`}
            />
          ))}
        </View>

        {/* Distance : presets + saisie perso */}
        <AppText
          variant="button"
          color={theme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Distance
        </AppText>
        <View style={styles.filterChips}>
          {(
            [
              { label: "Toutes", value: null },
              { label: "25 km", value: 25 },
              { label: "50 km", value: 50 },
              { label: "100 km", value: 100 },
            ] as const
          ).map((opt) => (
            <FilterChip
              key={opt.label}
              label={opt.label}
              selected={maxDistanceKm === opt.value && customKm === ""}
              onPress={() => {
                setMaxDistanceKm(opt.value);
                setCustomKm("");
              }}
              testID={`competitions-filter-distance-${opt.value ?? "all"}`}
            />
          ))}
        </View>
        <TextInput
          style={[
            styles.customInput,
            {
              color: theme.text,
              borderColor: customKm ? theme.primary : theme.border,
              backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
            },
          ]}
          value={customKm}
          onChangeText={(t) => {
            const digits = t.replace(/[^0-9]/g, "");
            setCustomKm(digits);
            setMaxDistanceKm(digits ? parseInt(digits, 10) : null);
          }}
          keyboardType="number-pad"
          placeholder="Distance perso (km)"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Distance personnalisée en kilomètres"
          accessibilityHint="Filtre les compétitions dans ce rayon"
          testID="competitions-filter-distance-custom"
        />
        {!userLocation && (
          <AppText
            variant="caption"
            color={theme.textSecondary}
            style={styles.filterNote}
          >
            Activez la localisation pour filtrer par distance.
          </AppText>
        )}

        {/* Période : presets + plage perso (calendrier) */}
        <AppText
          variant="button"
          color={theme.textSecondary}
          style={styles.filterSectionLabel}
        >
          Période
        </AppText>
        <View style={styles.filterChips}>
          {(
            [
              { label: "Toutes", value: "ALL" },
              { label: "Ce mois", value: "MONTH" },
              { label: "3 mois", value: "THREE_MONTHS" },
              { label: "6 mois", value: "SIX_MONTHS" },
            ] as const satisfies {
              label: string;
              value: CompetitionDatePeriod;
            }[]
          ).map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              selected={datePeriod === opt.value && !dateFrom && !dateTo}
              onPress={() => {
                setDatePeriod(opt.value);
                setDateFrom(null);
                setDateTo(null);
              }}
              testID={`competitions-filter-period-${opt.value}`}
            />
          ))}
        </View>
        {/* Plage de dates perso (calendrier) */}
        <View style={styles.dateRangeRow}>
          <TouchableOpacity
            style={[styles.dateButton, { borderColor: theme.border }]}
            onPress={() => setPickerFor("from")}
            accessibilityRole="button"
            accessibilityLabel="Date de début"
            accessibilityHint="Ouvre le calendrier pour choisir la date de début"
            testID="competitions-filter-date-from"
          >
            <AppText variant="caption" color={theme.textSecondary}>
              Du
            </AppText>
            <AppText variant="body" color={theme.text}>
              {fmtDate(dateFrom)}
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dateButton, { borderColor: theme.border }]}
            onPress={() => setPickerFor("to")}
            accessibilityRole="button"
            accessibilityLabel="Date de fin"
            accessibilityHint="Ouvre le calendrier pour choisir la date de fin"
            testID="competitions-filter-date-to"
          >
            <AppText variant="caption" color={theme.textSecondary}>
              Au
            </AppText>
            <AppText variant="body" color={theme.text}>
              {fmtDate(dateTo)}
            </AppText>
          </TouchableOpacity>
          {(dateFrom !== null || dateTo !== null) && (
            <TouchableOpacity
              style={styles.dateClear}
              onPress={() => {
                setDateFrom(null);
                setDateTo(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Effacer les dates"
              accessibilityHint="Réinitialise la plage de dates"
            >
              <AppText variant="caption" color={theme.primary}>
                Effacer
              </AppText>
            </TouchableOpacity>
          )}
        </View>
        {pickerFor && (
          <DateTimePicker
            value={(pickerFor === "from" ? dateFrom : dateTo) ?? new Date()}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={(event, selected) => {
              if (Platform.OS !== "ios") setPickerFor(null);
              if (event.type === "dismissed") {
                setPickerFor(null);
                return;
              }
              if (selected) {
                if (pickerFor === "from") setDateFrom(selected);
                else setDateTo(selected);
                // Choisir une plage perso annule les presets.
                setDatePeriod("ALL");
              }
            }}
          />
        )}
        {Platform.OS === "ios" && pickerFor && (
          <TouchableOpacity
            style={[styles.dateDone, { backgroundColor: theme.primary }]}
            onPress={() => setPickerFor(null)}
            accessibilityRole="button"
          >
            <AppText variant="button" color="#FFF">
              OK
            </AppText>
          </TouchableOpacity>
        )}
      </FilterSheet>
    </SafeAreaView>
  );
};

/**
 * Shown once the automatic page scan has used its budget while older pages
 * remain: lets the user keep searching instead of an endless spinner.
 */
const LoadMoreButton = ({
  onLoadMore,
}: {
  onLoadMore: () => Promise<void>;
}) => (
  <AppButton
    title="Charger plus"
    variant="outline"
    testID="competitions-load-more-button"
    accessibilityHint="Charge plus de compétitions pour poursuivre la recherche"
    onPress={() => {
      onLoadMore().catch(() => {});
    }}
    style={styles.loadMoreButton}
  />
);

const ListFooter = ({
  isLoadingMore,
  canLoadMore,
  onLoadMore,
}: {
  isLoadingMore: boolean;
  canLoadMore: boolean;
  onLoadMore: () => Promise<void>;
}) => {
  const { theme } = useTheme();

  if (!isLoadingMore) {
    return canLoadMore ? (
      <View style={styles.footerLoader}>
        <LoadMoreButton onLoadMore={onLoadMore} />
      </View>
    ) : (
      <View style={styles.footerEmpty} />
    );
  }

  return (
    <View style={styles.footerLoader} testID="competitions-load-more">
      <ActivityIndicator color={theme.primary} />
    </View>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const { theme } = useTheme(); // Hook usage inside component
  let color = theme.textSecondary;
  let label = status;

  if (status === "LIVE") {
    color = theme.danger;
    label = "EN DIRECT";
  } else if (status === "UPCOMING") {
    color = theme.secondary;
    label = "À VENIR";
  } else if (status === "PAST") {
    color = theme.textSecondary;
    label = "TERMINÉ";
  }

  return (
    <View style={[styles.statusBadge, { backgroundColor: color }]}>
      <AppText
        variant="caption"
        weight="600"
        color="white"
        style={styles.statusText}
      >
        {label}
      </AppText>
    </View>
  );
};
