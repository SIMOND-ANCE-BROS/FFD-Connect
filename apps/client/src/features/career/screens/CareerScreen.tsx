/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors */
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { CompositeScreenProps } from "@react-navigation/native";
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  Award,
  Calendar,
  MapPin,
  Trophy,
  User,
  Users,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { NotificationBell } from "../../../components/NotificationBell";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList, TabParamList } from "../../../navigation/types";
import type {
  CareerPartnership,
  CareerSearchMember,
} from "../../../services/BackendService";
import { BackendService } from "../../../services/BackendService";
import { getPodiumStyle } from "../../../utils/podium";
import { useCareerLogic } from "../hooks/useCareerLogic";

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, "Career">,
  NativeStackScreenProps<RootStackParamList>
>;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SEARCH_DEBOUNCE_MS = 350;

export const CareerScreen = ({ navigation }: Props) => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  // Hauteur mesurée de l'en-tête épinglé (titre + recherche) pour caler le
  // paddingTop du contenu. Estimation initiale avant onLayout.
  const [headerH, setHeaderH] = useState(insets.top + 120);
  const auth = useAuthRepository();
  const { partnerships, registrations, results, loading, refresh } =
    useCareerLogic();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CareerSearchMember[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const runSearch = useCallback(
    async (q: string) => {
      const config = await auth.getAuthConfig();
      if (!config.authToken || !q.trim() || q.trim().length < 2) {
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      try {
        const list = await BackendService.searchCareerMembers(
          config.authToken,
          q,
        );
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      }
      setSearchLoading(false);
    },
    [auth],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }
      runSearch(searchQuery).catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery, runSearch]);

  const currentPartnerships = partnerships.filter((p) => p.isCurrent);
  const pastPartnerships = partnerships.filter((p) => !p.isCurrent);

  const openMemberCareer = useCallback(
    (member: CareerSearchMember) => {
      setSearchQuery("");
      setSearchResults([]);
      const userName = `${member.firstName} ${member.lastName}`.trim();
      navigation
        .getParent<NativeStackNavigationProp<RootStackParamList>>()
        .navigate("ViewCareer", {
          userId: member.id,
          userName: userName || undefined,
        });
    },
    [navigation],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            progressViewOffset={headerH}
            onRefresh={() => {
              refresh().catch(() => {});
            }}
            tintColor={currentTheme.primary}
          />
        }
      >
        <View style={styles.sectionsWrapper}>
          {loading && !partnerships.length && !registrations.length ? (
            <View testID="career-loading" style={styles.centered}>
              <ActivityIndicator size="large" color={currentTheme.primary} />
            </View>
          ) : (
            <>
              {/* Partenariats */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Users size={22} color={currentTheme.primary} />
                  <AppText
                    variant="h2"
                    style={[styles.sectionTitle, { color: currentTheme.text }]}
                  >
                    Partenariats
                  </AppText>
                </View>
                {currentPartnerships.length === 0 &&
                pastPartnerships.length === 0 ? (
                  <AppText
                    variant="body"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Aucun partenaire enregistré.
                  </AppText>
                ) : (
                  <>
                    {currentPartnerships.map((p) => (
                      <PartnershipCard
                        key={p.id}
                        item={p}
                        theme={currentTheme}
                        isCurrent
                      />
                    ))}
                    {pastPartnerships.map((p) => (
                      <PartnershipCard
                        key={p.id}
                        item={p}
                        theme={currentTheme}
                        isCurrent={false}
                      />
                    ))}
                  </>
                )}
              </View>

              {/* Compétitions (inscriptions) */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Calendar size={22} color={currentTheme.primary} />
                  <AppText
                    variant="h2"
                    style={[styles.sectionTitle, { color: currentTheme.text }]}
                  >
                    Compétitions
                  </AppText>
                </View>
                {registrations.length === 0 ? (
                  <AppText
                    variant="body"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Aucune inscription à une compétition.
                  </AppText>
                ) : (
                  registrations.slice(0, 30).map((r) => (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.card,
                        {
                          backgroundColor: currentTheme.surface,
                          borderColor: currentTheme.border,
                        },
                      ]}
                      onPress={() =>
                        navigation
                          .getParent<
                            NativeStackNavigationProp<RootStackParamList>
                          >()
                          .navigate("CompetitionDetail", {
                            competitionId: r.competition.id,
                          })
                      }
                      activeOpacity={0.7}
                    >
                      <View style={styles.cardTitleRow}>
                        <AppText
                          variant="h3"
                          style={[styles.flex1, { color: currentTheme.text }]}
                          numberOfLines={1}
                        >
                          {r.competition.title}
                        </AppText>
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: statusColor(r.status) },
                          ]}
                        >
                          <AppText variant="caption" style={styles.badgeText}>
                            {statusLabel(r.status)}
                          </AppText>
                        </View>
                      </View>
                      <View style={styles.row}>
                        <MapPin size={14} color={currentTheme.textSecondary} />
                        <AppText
                          variant="caption"
                          style={[
                            styles.iconLabel,
                            { color: currentTheme.textSecondary },
                          ]}
                        >
                          {r.competition.location} ·{" "}
                          {formatDate(r.competition.date)}
                        </AppText>
                      </View>
                      <AppText
                        variant="caption"
                        style={[
                          styles.subCaption,
                          { color: currentTheme.textSecondary },
                        ]}
                      >
                        {r.event.category} · {r.event.ageGroup}
                        {r.bibNumber != null ? ` · Dossard ${r.bibNumber}` : ""}
                        {r.partnerName ? ` · ${r.partnerName}` : ""}
                      </AppText>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {/* Résultats & classement */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Award size={22} color={currentTheme.primary} />
                  <AppText
                    variant="h2"
                    style={[styles.sectionTitle, { color: currentTheme.text }]}
                  >
                    Résultats & classement
                  </AppText>
                </View>
                {results.length === 0 ? (
                  <AppText
                    variant="body"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Aucun résultat enregistré pour le moment.
                  </AppText>
                ) : (
                  results.slice(0, 30).map((r) => {
                    const podium = getPodiumStyle(
                      r.ranking,
                      currentTheme.primary,
                    );
                    return (
                      <TouchableOpacity
                        key={r.id}
                        style={[
                          styles.card,
                          styles.resultCard,
                          {
                            backgroundColor: currentTheme.surface,
                            borderColor: currentTheme.border,
                          },
                        ]}
                        onPress={() =>
                          navigation
                            .getParent<
                              NativeStackNavigationProp<RootStackParamList>
                            >()
                            .navigate("LiveResults", {
                              competitionId: r.competition.id,
                            })
                        }
                        activeOpacity={0.7}
                      >
                        <View style={styles.resultRow}>
                          <View
                            style={[
                              styles.rankBadge,
                              { backgroundColor: podium.backgroundColor },
                            ]}
                          >
                            {podium.isPodium ? (
                              // Podium badge identical to the LiveResults screen
                              // (same Trophy size/color/fill). Founder decision
                              // from beta QA: mirror the results screen exactly.
                              <Trophy size={20} color="white" fill="white" />
                            ) : (
                              // Off-podium keeps the historical white-on-primary
                              // rank number (unchanged look for ranks 4+).
                              <AppText
                                variant="h3"
                                style={{ color: podium.textColor }}
                              >
                                {r.ranking}
                              </AppText>
                            )}
                          </View>
                          <View style={styles.resultBody}>
                            <AppText
                              variant="h3"
                              style={{ color: currentTheme.text }}
                            >
                              {r.competition.title}
                            </AppText>
                            <AppText
                              variant="caption"
                              style={{ color: currentTheme.textSecondary }}
                            >
                              {r.event.category} · {r.event.ageGroup}
                              {r.round ? ` · ${r.round}` : ""} ·{" "}
                              {formatDate(r.competition.date)}
                            </AppText>
                            <AppText
                              variant="caption"
                              weight="bold"
                              style={{ color: currentTheme.primary }}
                            >
                              {r.totalParticipants
                                ? `${r.ranking}e sur ${r.totalParticipants}`
                                : `${r.ranking}e`}
                            </AppText>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* En-tête verre FIXE (titre + cloche + recherche membre épinglée) ;
          le contenu défile dessous. */}
      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title="Carrière"
        onHeightChange={setHeaderH}
        right={
          <NotificationBell
            theme={currentTheme}
            isDark={isDark}
            onPress={() =>
              navigation
                .getParent<NativeStackNavigationProp<RootStackParamList>>()
                .navigate("Notifications")
            }
          />
        }
      >
        {/* Même SearchBar + spinner interne que l'impersonation (UX unifiée). */}
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un membre…"
          loading={searchLoading}
          testID="career-search"
        />
        {searchResults.length > 0 && (
          <View
            style={[
              styles.searchResults,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
          >
            {searchResults.map((member) => (
              <TouchableOpacity
                key={member.id}
                style={[
                  styles.searchResultItem,
                  { borderColor: currentTheme.border },
                ]}
                onPress={() => openMemberCareer(member)}
                activeOpacity={0.7}
              >
                <User size={18} color={currentTheme.primary} />
                <View style={styles.searchResultText}>
                  <AppText variant="body" style={{ color: currentTheme.text }}>
                    {member.firstName} {member.lastName}
                  </AppText>
                  {member.clubName ? (
                    <AppText
                      variant="caption"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {member.clubName}
                    </AppText>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </PinnedHeader>
    </SafeAreaView>
  );
};

function statusColor(status: string): string {
  if (status === "CONFIRMED") return "#4CAF50";
  if (status === "PENDING") return "#FF9800";
  if (status === "CANCELLED") return "#9E9E9E";
  return "#757575";
}

function statusLabel(status: string): string {
  if (status === "CONFIRMED") return "Confirmée";
  if (status === "PENDING") return "En attente";
  if (status === "CANCELLED") return "Annulée";
  return status;
}

function PartnershipCard({
  item,
  theme,
  isCurrent,
}: {
  item: CareerPartnership;
  theme: {
    text: string;
    textSecondary: string;
    surface: string;
    border: string;
    primary: string;
  };
  isCurrent: boolean;
}) {
  const name = `${item.partner.firstName} ${item.partner.lastName}`.trim();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.partnerRow}>
        <AppText variant="h3" style={{ color: theme.text }}>
          {name}
        </AppText>
        {isCurrent && (
          <View style={[styles.badge, { backgroundColor: theme.primary }]}>
            <AppText variant="caption" style={styles.badgeText}>
              Actuel
            </AppText>
          </View>
        )}
      </View>
      {item.partner.clubName ? (
        <AppText variant="caption" style={{ color: theme.textSecondary }}>
          {item.partner.clubName}
          {item.secondaryClubName ? ` / ${item.secondaryClubName}` : ""}
        </AppText>
      ) : null}
      <AppText
        variant="caption"
        style={[styles.partnerDate, { color: theme.textSecondary }]}
      >
        {isCurrent ? "Depuis " : "Du "}
        {formatDate(item.startDate)}
        {item.endDate ? ` au ${formatDate(item.endDate)}` : ""}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrapper: {
    position: "relative",
  },
  searchSpinner: {
    position: "absolute",
    right: 30,
    top: 12,
  },
  searchResults: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 220,
    overflow: "hidden",
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  searchResultText: { flex: 1, marginLeft: 10 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  sectionsWrapper: { paddingHorizontal: 20, paddingTop: 8 },
  centered: { paddingVertical: 40, alignItems: "center" },
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  row: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  partnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: "#fff" },
  resultCard: {},
  resultRow: { flexDirection: "row", alignItems: "center" },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  resultBody: { flex: 1 },
  sectionTitle: { marginLeft: 8 },
  flex1: { flex: 1 },
  iconLabel: { marginLeft: 4 },
  subCaption: { marginTop: 4 },
  partnerDate: { marginTop: 2 },
});
