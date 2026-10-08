import { ApiCompetition } from "@ffd-connect/shared";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Calendar,
  ChevronRight,
  MapPin,
  Plus,
  Users,
} from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { toCompetitionFilter } from "../../../utils/typeGuards";

type CompetitionStatus = "DRAFT" | "OPEN" | "CLOSED" | "LIVE";

interface Competition extends Omit<ApiCompetition, "status"> {
  status: CompetitionStatus;
  registrants: number;
}

const MOCK_COMPETITIONS: Competition[] = [
  {
    id: "1",
    title: "Grand Prix de Paris",
    date: "12 Mars 2026",
    location: "Gymnase Pierre de Coubertin, Paris",
    status: "OPEN",
    registrants: 142,
  },
  {
    id: "2",
    title: "Open de Danse Latine",
    date: "15 Avril 2026",
    location: "Salle Polyvalente, Lyon",
    status: "DRAFT",
    registrants: 0,
  },
  {
    id: "3",
    title: "Championnat Régional IDF",
    date: "10 Janvier 2026",
    location: "Stade Charléty",
    status: "CLOSED",
    registrants: 89,
  },
];

type Props = NativeStackScreenProps<RootStackParamList, "ClubCompetitions">;

export const ClubCompetitionsScreen = ({ navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "DRAFT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 130);

  const filteredData = MOCK_COMPETITIONS.filter((c) => {
    if (filter !== "ALL" && c.status !== filter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) || c.location.toLowerCase().includes(q)
    );
  });

  const getStatusColor = (status: Competition["status"]) => {
    switch (status) {
      case "OPEN":
        return "#4CAF50";
      case "DRAFT":
        return "#FF9800";
      case "LIVE":
        return "#E91E63";
      case "CLOSED":
        return "#9E9E9E";
      default:
        return theme.text;
    }
  };

  const getStatusLabel = (status: Competition["status"]) => {
    switch (status) {
      case "OPEN":
        return "Inscriptions Ouvertes";
      case "DRAFT":
        return "Brouillon";
      case "LIVE":
        return "En Cours";
      case "CLOSED":
        return "Terminé";
      default:
        return status;
    }
  };

  const renderItem = ({ item }: { item: Competition }) => {
    const statusColor = getStatusColor(item.status);

    return (
      <TouchableOpacity
        accessibilityRole="button"
        testID={`club-competition-${item.id}`}
        style={[styles.card, { backgroundColor: theme.surface }]}
        activeOpacity={0.7}
        onPress={() => {
          // Navigate to detail or editing
          navigation.navigate("ClubCompetitionEditor", {
            competition: item as unknown as ApiCompetition,
          });
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
              {getStatusLabel(item.status)}
            </AppText>
          </View>
          {item.status === "OPEN" && (
            <View
              style={[
                styles.registrantBadge,
                { backgroundColor: theme.background },
              ]}
            >
              <Users size={14} color={theme.textSecondary} />
              <AppText variant="caption" style={styles.registrantCount}>
                {item.registrants}
              </AppText>
            </View>
          )}
        </View>

        <AppText variant="h3" style={[styles.cardTitle, { color: theme.text }]}>
          {item.title}
        </AppText>

        <View style={styles.infoRow}>
          <Calendar size={16} color={theme.textSecondary} />
          <AppText variant="body" style={styles.infoText}>
            {item.date}
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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlashList
        data={filteredData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerH, paddingBottom: insets.bottom + 20 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <AppText variant="body" style={{ color: theme.textSecondary }}>
              Aucune compétition trouvée.
            </AppText>
          </View>
        }
      />

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
              { label: "Ouvertes", value: "OPEN" },
              { label: "Brouillons", value: "DRAFT" },
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
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
  registrantBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
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
  },
  statusLabel: {
    fontWeight: "bold",
  },
  registrantCount: {
    color: "#64748b", // fallback for theme.textSecondary if needed, better use dynamic in array if possible
    marginLeft: 4,
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
