/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Award, Calendar, MapPin, Trophy, Users } from "lucide-react-native";
import React, { useState } from "react";
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
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import type { CareerPartnership } from "../../../services/BackendService";
import { getPodiumStyle } from "../../../utils/podium";
import { useCareerUserLogic } from "../hooks/useCareerUserLogic";

type Props = NativeStackScreenProps<RootStackParamList, "ViewCareer">;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusColor(status: string): string {
  if (status === "CONFIRMED") return "#4CAF50";
  if (status === "PENDING") return "#FF9800";
  if (status === "CANCELLED") return "#9E9E9E";
  return "#757575";
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

export const ViewCareerScreen = ({ navigation, route }: Props) => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 90);
  const userId = route.params.userId;
  const userName =
    (route.params.userName?.trim() !== ""
      ? route.params.userName?.trim()
      : undefined) ?? "Ce licencié";
  const { partnerships, registrations, results, loading, refresh } =
    useCareerUserLogic(userId);

  const currentPartnerships = partnerships.filter((p) => p.isCurrent);
  const pastPartnerships = partnerships.filter((p) => !p.isCurrent);

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
        contentContainerStyle={{
          ...styles.scrollContent,
          paddingTop: headerH,
        }}
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
        {loading && !partnerships.length && !registrations.length ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={currentTheme.primary} />
          </View>
        ) : (
          <>
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
                      navigation.navigate("CompetitionDetail", {
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
                          {r.status}
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
                        navigation.navigate("LiveResults", {
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
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title={`Carrière de ${userName}`}
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      >
        <AppText
          variant="caption"
          style={[styles.headerCaption, { color: currentTheme.textSecondary }]}
        >
          Partenariats, compétitions et résultats
        </AppText>
      </PinnedHeader>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  headerTitle: { flex: 1 },
  headerCaption: { paddingHorizontal: 16, marginBottom: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
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
