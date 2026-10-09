import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  FlashList as NativeFlashList,
  FlashListProps,
} from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Trophy, User } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
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
import { useCompetitionRepository } from "../context/CompetitionContext";
import { formatDiscipline } from "../../../utils/discipline";
const FlashList = NativeFlashList as <T>(
  props: FlashListProps<T>,
) => React.ReactElement | null;

type Props = NativeStackScreenProps<RootStackParamList, "EventRegistrants">;

interface Registrant {
  user?: {
    id?: string;
    firstName: string;
    lastName: string;
    clubName: string | null;
    nationalRanking: number | null;
  };
}

export const EventRegistrantsScreen = ({ route, navigation }: Props) => {
  const { eventId, category, level } = route.params;
  const { getEventRegistrations } = useCompetitionRepository();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 110);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: registrants = [], isLoading: loading } = useQuery({
    queryKey: ["eventRegistrants", eventId],
    queryFn: async () => {
      const data = await getEventRegistrations(eventId);
      return data;
    },
  });

  // Filtre local par nom / prénom de l'inscrit.
  const filteredRegistrants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return registrants;
    return registrants.filter((item: Registrant) => {
      const name =
        `${item.user?.firstName ?? ""} ${item.user?.lastName ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [registrants, searchQuery]);

  const renderHeader = () => (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title={`${formatDiscipline(category)} - ${level}`}
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
    >
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher un inscrit…"
        testID="event-registrants-search"
      />
    </PinnedHeader>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <FlashList<Registrant>
        data={filteredRegistrants}
        keyExtractor={(item: Registrant, index: number) =>
          item.user?.id ?? index.toString()
        }
        // headerH already includes the header's fade tail: no extra offset.
        contentContainerStyle={{ ...styles.list, paddingTop: headerH }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <User
              size={48}
              color={theme.textSecondary}
              style={styles.emptyIcon}
            />
            <AppText
              variant="h3"
              align="center"
              style={[styles.emptyTitle, { color: theme.text }]}
            >
              Aucun inscrit
            </AppText>
            <AppText variant="body" align="center" color={theme.textSecondary}>
              Personne ne s'est encore inscrit à cette épreuve.
            </AppText>
          </View>
        }
        renderItem={({ item }: { item: Registrant }) => (
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <View style={styles.rankContainer}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                style={styles.rankCaption}
              >
                Rang
              </AppText>
              <View style={[styles.rankBadge, { borderColor: theme.primary }]}>
                <AppText variant="h3" weight="bold" color={theme.primary}>
                  {item.user?.nationalRanking ?? "-"}
                </AppText>
              </View>
            </View>
            <View style={styles.infoContainer}>
              <View style={styles.participantRow}>
                <User
                  size={16}
                  color={theme.text}
                  style={styles.participantIcon}
                />
                <AppText variant="body" weight="600" color={theme.text}>
                  {item.user?.firstName} {item.user?.lastName}
                </AppText>
              </View>
              <View style={styles.clubRow}>
                <Trophy
                  size={14}
                  color={theme.textSecondary}
                  style={styles.clubIcon}
                />
                <AppText variant="caption" color={theme.textSecondary}>
                  {item.user?.clubName ?? "Club inconnu"}
                </AppText>
              </View>
            </View>
          </View>
        )}
      />
      {renderHeader()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  card: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 12, // More rounded like other modern cards
    marginBottom: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  rankContainer: {
    alignItems: "center",
    paddingRight: 16,
    borderRightWidth: 1,
    borderRightColor: "rgba(0,0,0,0.05)", // Subtle separator
    minWidth: 60,
  },
  rankBadge: {
    marginTop: 4,
  },
  infoContainer: { flex: 1, paddingLeft: 16 },
  emptyContainer: {
    marginTop: 24,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backButton: { padding: 8, flexDirection: "row", alignItems: "center" },
  headerTitleContainer: {
    alignItems: "center",
    transform: [{ translateX: -20 }],
  },
  headerTitle: { fontWeight: "bold", fontSize: 17 },
  headerSubtitle: { fontSize: 12 },
  headerRightSpacer: { width: 40 },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: { marginBottom: 8 },
  rankCaption: { textTransform: "uppercase", fontSize: 10 },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  participantIcon: { marginRight: 6 },
  clubRow: { flexDirection: "row", alignItems: "center" },
  clubIcon: { marginRight: 6 },
});
