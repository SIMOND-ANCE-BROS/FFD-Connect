import type { ApiCompetition } from "@ffd-connect/shared";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Calendar, ChevronRight, MapPin, Plus } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import {
  type CompetitionFilter,
  toCompetitionFilter,
} from "../../../utils/typeGuards";
import {
  formatParisDate,
  getEffectiveCompetitionStatus,
} from "../../competitions/utils/competitionCard";
import { useClubCompetitions } from "../hooks/useClubCompetitions";

type DisplayStatus = "UPCOMING" | "LIVE" | "PAST" | "CANCELLED";

/**
 * Status shown on the card: CANCELLED as stored, otherwise derived from the
 * date (a stored UPCOMING can be stale), like the public competition list.
 */
export function displayStatus(
  competition: Pick<ApiCompetition, "status" | "date">,
  now: Date = new Date(),
): DisplayStatus {
  if (competition.status === "CANCELLED") return "CANCELLED";
  const effective = getEffectiveCompetitionStatus(
    competition.status,
    competition.date,
    now,
  );
  return effective === "LIVE" || effective === "PAST" ? effective : "UPCOMING";
}

const matchesFilter = (status: DisplayStatus, filter: CompetitionFilter) => {
  if (filter === "UPCOMING") return status === "UPCOMING" || status === "LIVE";
  if (filter === "PAST") return status === "PAST" || status === "CANCELLED";
  return true;
};

const STATUS_COLORS: Record<DisplayStatus, string> = {
  UPCOMING: "#4CAF50",
  LIVE: "#E91E63",
  PAST: "#9E9E9E",
  CANCELLED: "#F44336",
};

const STATUS_LABELS: Record<DisplayStatus, string> = {
  UPCOMING: "À venir",
  LIVE: "En cours",
  PAST: "Terminée",
  CANCELLED: "Annulée",
};

const formatDate = (iso: string): string => {
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  return formatParisDate(iso);
};

type Props = NativeStackScreenProps<RootStackParamList, "ClubCompetitions">;

export const ClubCompetitionsScreen = ({ navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const [filter, setFilter] = useState<CompetitionFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 130);
  const {
    data: competitions = [],
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useClubCompetitions();

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return competitions.filter((c) => {
      if (!matchesFilter(displayStatus(c), filter)) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
      );
    });
  }, [competitions, filter, searchQuery]);

  const renderItem = ({ item }: { item: ApiCompetition }) => {
    const status = displayStatus(item);
    const statusColor = STATUS_COLORS[status];

    return (
      <TouchableOpacity
        accessibilityRole="button"
        testID={`club-competition-${item.id}`}
        style={[styles.card, { backgroundColor: theme.surface }]}
        activeOpacity={0.7}
        onPress={() => {
          navigation.navigate("ClubCompetitionEditor", { competition: item });
        }}
      >
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${statusColor}20`, borderColor: statusColor },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <AppText
              variant="caption"
              style={[styles.statusLabel, { color: statusColor }]}
            >
              {STATUS_LABELS[status]}
            </AppText>
          </View>
        </View>

        <AppText variant="h3" style={[styles.cardTitle, { color: theme.text }]}>
          {item.title}
        </AppText>

        <View style={styles.infoRow}>
          <Calendar size={16} color={theme.textSecondary} />
          <AppText variant="body" style={styles.infoText}>
            {formatDate(item.date)}
          </AppText>
        </View>

        <View style={styles.infoRowWithMargin}>
          <MapPin size={16} color={theme.textSecondary} />
          <AppText variant="body" style={styles.infoText}>
            {item.location}
          </AppText>
        </View>

        <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>
          <AppText variant="button" style={{ color: theme.primary }}>
            Gérer
          </AppText>
          <ChevronRight size={18} color={theme.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isError) {
      return (
        <View style={styles.emptyContainer} testID="club-competitions-error">
          <AppText
            variant="body"
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            Impossible de charger vos compétitions.
          </AppText>
          <TouchableOpacity
            accessibilityRole="button"
            testID="club-competitions-retry"
            style={[styles.retryButton, { borderColor: theme.primary }]}
            onPress={() => {
              refetch().catch(() => {});
            }}
          >
            <AppText variant="button" style={{ color: theme.primary }}>
              Réessayer
            </AppText>
          </TouchableOpacity>
        </View>
      );
    }
    const hasFilter = filter !== "ALL" || searchQuery.trim() !== "";
    return (
      <View style={styles.emptyContainer} testID="club-competitions-empty">
        <AppText
          variant="body"
          style={[styles.emptyText, { color: theme.textSecondary }]}
        >
          {hasFilter
            ? "Aucune compétition trouvée."
            : "Votre club n'organise encore aucune compétition. Touchez « Créer » pour en ajouter une."}
        </AppText>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isLoading ? (
        <View
          style={[styles.loadingContainer, { paddingTop: headerH }]}
          testID="club-competitions-loading"
        >
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlashList
          data={filteredData}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onRefresh={() => {
            refetch().catch(() => {});
          }}
          refreshing={isRefetching}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerH, paddingBottom: insets.bottom + 100 },
          ]}
          ListEmptyComponent={renderEmpty}
        />
      )}

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Événements"
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      >
        {/* Recherche AU-DESSUS des filtres, comme partout ailleurs dans l'app. */}
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un événement…"
          testID="club-competitions-search"
        />
        <View style={styles.filterContainer}>
          <FluidSegmentedTab
            activeValue={filter}
            onChange={(val) => setFilter(toCompetitionFilter(val))}
            testID="club-competitions-filter-tabs"
            options={[
              { label: "Toutes", value: "ALL" },
              { label: "À venir", value: "UPCOMING" },
              { label: "Passées", value: "PAST" },
            ]}
          />
        </View>
      </PinnedHeader>

      <TouchableOpacity
        accessibilityRole="button"
        testID="club-competitions-create-button"
        style={[
          styles.fab,
          { backgroundColor: theme.primary, bottom: insets.bottom + 20 },
        ]}
        onPress={() => navigation.navigate("ClubCompetitionEditor")}
      >
        <Plus size={24} color="#FFF" />
        <AppText variant="button" style={styles.fabText}>
          Créer
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 20,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 50,
    paddingHorizontal: 20,
  },
  emptyText: {
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
  },
  statusLabel: {
    fontWeight: "bold",
  },
  cardTitle: {
    marginBottom: 8,
  },
  infoText: {
    color: "#64748b",
    marginLeft: 6,
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  fabText: {
    color: "#FFF",
    marginLeft: 8,
  },
  infoRowWithMargin: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
});
