import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Activity, Trophy } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { getPodiumStyle, isPodiumRank } from "../../../utils/podium";
import { Result } from "../context/CompetitionContext";
import { useLiveResultsLogic } from "../hooks/useLiveResultsLogic";

type Props = NativeStackScreenProps<RootStackParamList, "LiveResults">;

export const LiveResultsScreen = ({ route, navigation }: Props) => {
  const { competitionId } = route.params;
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 110);
  const [searchQuery, setSearchQuery] = useState("");

  const { state, actions } = useLiveResultsLogic({ competitionId });
  const { sections, refreshing, eventLabel } = state;
  const { loadResults } = actions;

  // Filtre local par nom de couple / compétiteur.
  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((section) => ({
        ...section,
        data: section.data.filter((r) => {
          const name = r.details.participant ?? r.details.name ?? "";
          return name.toLowerCase().includes(q);
        }),
      }))
      .filter((section) => section.data.length > 0);
  }, [sections, searchQuery]);

  const renderHeader = () => (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title={eventLabel || "Résultats en direct"}
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
    >
      <View style={styles.liveIndicatorContainer}>
        <View style={[styles.liveDot, { backgroundColor: theme.danger }]} />
        <AppText variant="caption" color={theme.textSecondary}>
          Mises à jour en temps réel
        </AppText>
      </View>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher un couple…"
        testID="live-results-search"
      />
    </PinnedHeader>
  );

  // Single source of the podium → medal-colour mapping: getPodiumStyle
  // (utils/podium.ts). getStatusColor only reaches it for podium ranks, so its
  // backgroundColor is always a medal token (gold/silver/bronze) here.
  const getStatusColor = (status?: string, rank?: number) => {
    if (status === "QUALIFIED") return theme.success; // Green
    if (status === "ELIMINATED") return theme.danger; // Red
    if (rank !== undefined && isPodiumRank(rank)) {
      return getPodiumStyle(rank, theme.primary).backgroundColor;
    }
    return theme.textSecondary;
  };

  const renderSectionHeader = ({
    section: { title },
  }: {
    section: { title: string };
  }) => (
    <View
      style={[
        styles.sectionHeader,
        {
          backgroundColor: theme.background,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <AppText variant="h3" weight="bold" color={theme.primary}>
        {title}
      </AppText>
    </View>
  );

  const renderItem = ({ item }: { item: Result }) => {
    const status = item.details.status;
    const isQualified = status === "QUALIFIED";
    const isEliminated = status === "ELIMINATED";
    const isPodium = !status && isPodiumRank(item.ranking);
    const marks = item.details.marks;

    const statusColor = getStatusColor(status, item.ranking);

    // Clean up participant name (remove "Couple " prefix)
    const rawName =
      item.details.participant ?? item.details.name ?? "Participant";
    const participantName = rawName.replace(/^Couple\s+/i, "");

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.surface },
          isQualified && styles.qualifiedCard,
          isQualified && { borderLeftColor: theme.success },
          isEliminated && styles.eliminatedCard,
        ]}
      >
        <View
          style={[
            styles.rankBadge,
            {
              backgroundColor: isPodium
                ? statusColor
                : isQualified
                  ? `${theme.success}20`
                  : theme.surface,
              borderColor: statusColor,
            },
            isPodium ? styles.rankBadgePodium : styles.rankBadgeNormal,
          ]}
        >
          {isPodium ? (
            <Trophy size={20} color="white" fill="white" />
          ) : isQualified ? (
            <AppText
              weight="bold"
              style={[styles.rankBadgeText, { color: theme.success }]}
            >
              Q
            </AppText>
          ) : isEliminated ? (
            <AppText
              weight="bold"
              style={[styles.rankBadgeText, { color: theme.danger }]}
            >
              X
            </AppText>
          ) : (
            <AppText style={[styles.rankBadgeText, { color: statusColor }]}>
              #{item.ranking}
            </AppText>
          )}
        </View>

        <View style={styles.info}>
          <View style={styles.participantRow}>
            <View style={styles.participantNameContainer}>
              <AppText
                variant="body"
                weight="bold"
                style={[styles.participantName, { color: theme.text }]}
              >
                {participantName}
              </AppText>
            </View>
            {/* Right Side Status Text */}
            <View style={styles.statusContainer}>
              {isQualified && (
                <View
                  style={[
                    styles.qualifiedBadge,
                    { backgroundColor: theme.success },
                  ]}
                >
                  <AppText variant="caption" weight="bold" color="white">
                    QUALIFIÉ
                  </AppText>
                </View>
              )}
              {isEliminated && (
                <View
                  style={[
                    styles.eliminatedBadge,
                    { backgroundColor: `${theme.danger}20` },
                  ]}
                >
                  <AppText
                    variant="caption"
                    weight="bold"
                    style={{ color: theme.danger }}
                  >
                    ÉLIMINÉ
                  </AppText>
                  {marks !== undefined && (
                    <AppText
                      variant="caption"
                      style={[
                        styles.eliminatedMarksText,
                        { color: theme.danger },
                      ]}
                    >
                      {marks} {marks > 1 ? "croix" : "croix"}
                    </AppText>
                  )}
                </View>
              )}
              {!status && isPodium && (
                <AppText
                  variant="h3"
                  weight="bold"
                  style={{ color: statusColor }}
                >
                  {item.ranking}
                </AppText>
              )}
              {!status && !isPodium && (
                <AppText
                  variant="body"
                  weight="bold"
                  style={{ color: theme.textSecondary }}
                >
                  #{item.ranking}
                </AppText>
              )}
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <SectionList
        sections={filteredSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            progressViewOffset={headerH}
            onRefresh={() => {
              loadResults().catch(() => {});
            }}
            tintColor={theme.primary}
          />
        }
        contentContainerStyle={{ ...styles.list, paddingTop: headerH + 8 }}
        stickySectionHeadersEnabled={true}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Activity
              size={48}
              color={theme.textSecondary}
              style={styles.emptyIcon}
            />
            <AppText
              color={theme.text}
              align="center"
              variant="h3"
              style={styles.emptyTitle}
            >
              En attente de résultats
            </AppText>
            <AppText variant="body" color={theme.textSecondary} align="center">
              Les résultats des épreuves en cours apparaîtront ici
              automatiquement.
            </AppText>
          </View>
        }
      />
      {renderHeader()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  rankBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  info: { flex: 1 },
  emptyContainer: {
    marginTop: 80,
    alignItems: "center",
    paddingHorizontal: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backButton: { padding: 8, flexDirection: "row", alignItems: "center" },
  headerTitleContainer: { alignItems: "center", flex: 1 },
  eventLabel: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  headerTitle: { fontWeight: "bold", fontSize: 17 },
  liveIndicatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 12 },
  headerRightSpacer: { width: 48 },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  rankBadgeText: { fontSize: 18 },
  participantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  participantNameContainer: { flex: 1, marginRight: 8 },
  participantName: { fontSize: 17 },
  statusContainer: { alignItems: "flex-end", minWidth: 80 },
  qualifiedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  eliminatedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignItems: "flex-end",
  },
  eliminatedMarksText: {
    marginTop: 2,
    fontSize: 10,
  },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: { marginBottom: 8 },
  qualifiedCard: { borderLeftWidth: 4 },
  eliminatedCard: { opacity: 0.7 },
  rankBadgePodium: { borderWidth: 0 },
  rankBadgeNormal: { borderWidth: 2 },
});
