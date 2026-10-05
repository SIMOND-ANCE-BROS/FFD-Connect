import { useNavigation } from "@react-navigation/native";
import { Check, Clock, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { SearchBar } from "../../../components/SearchBar";
import { useTheme } from "../../../context/ThemeContext";
// Side-effect : configure le client OpenAPI généré (baseUrl + auth + refresh).
import "../../../api/client";
import {
  competitionsControllerConfirmRegistration,
  competitionsControllerGetClubPendingRegistrations,
  competitionsControllerUnregisterMember,
} from "../../../api/generated/sdk.gen";
import type { ClubPendingRegistration } from "../../../stores/competition.store";
import {
  ClubService,
  type ClubRegistrationMode,
} from "../services/ClubService";

interface RegistrationRequest {
  id: string;
  eventId: string;
  userId: string;
  dancerName: string;
  competitionName: string;
  category: string;
  date: string;
  status: "PENDING";
}

/**
 * Ligne renvoyée par GET /competitions/club/pending-registrations. Le client
 * généré type la réponse en `unknown` (schéma libre côté backend) : on réutilise
 * la forme partagée `ClubPendingRegistration` en y ajoutant `createdAt`.
 */
type PendingRegistrationRow = ClubPendingRegistration & { createdAt: string };

/** Date relative FR courte à partir d'un ISO string (createdAt). */
const formatRelativeDate = (iso: string): string => {
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return "";
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round(
    (startOf(new Date()) - startOf(created)) / 86400000,
  );
  if (dayDiff <= 0) return "Aujourd'hui";
  if (dayDiff === 1) return "Hier";
  if (dayDiff < 7) return `Il y a ${dayDiff} jours`;
  return created.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
};

const mapRow = (row: PendingRegistrationRow): RegistrationRequest => ({
  id: row.id,
  eventId: row.eventId,
  userId: row.userId,
  dancerName: `${row.user.firstName} ${row.user.lastName}`.trim(),
  competitionName: row.competition?.title ?? "Compétition",
  category: `${row.event.category} - ${row.event.ageGroup}`,
  date: formatRelativeDate(row.createdAt),
  status: "PENDING",
});

export const ClubRegistrationsScreen = () => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [registrationMode, setRegistrationMode] =
    useState<ClubRegistrationMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [headerH, setHeaderH] = useState(insets.top + 120);

  const filteredRequests = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(
      (r) =>
        r.dancerName.toLowerCase().includes(q) ||
        r.competitionName.toLowerCase().includes(q),
    );
  }, [requests, searchQuery]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        // Le mode ne sert qu'à choisir le message d'état vide ; la liste vient
        // toujours de l'endpoint réel des inscriptions en attente.
        const [modeResult, pending] = await Promise.all([
          ClubService.getMyClubRegistrationMode().catch(() => null),
          competitionsControllerGetClubPendingRegistrations(),
        ]);
        if (!isMounted) return;

        setRegistrationMode(
          modeResult?.registrationMode ?? "MEMBERS_AUTO_CONFIRM",
        );

        if (pending.error || !pending.data) {
          setHasError(true);
          setRequests([]);
          return;
        }

        const rows = pending.data as PendingRegistrationRow[];
        setRequests(rows.map(mapRow));
      } catch {
        if (!isMounted) return;
        setHasError(true);
        setRequests([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load().catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const performAction = async (
    item: RegistrationRequest,
    action: "APPROVE" | "REJECT",
  ) => {
    // Retrait optimiste ; on restaure la liste si l'appel échoue.
    const previous = requests;
    setRequests((prev) => prev.filter((r) => r.id !== item.id));

    try {
      const { error } =
        action === "APPROVE"
          ? await competitionsControllerConfirmRegistration({
              path: { registrationId: item.id },
            })
          : await competitionsControllerUnregisterMember({
              body: { eventId: item.eventId, userId: item.userId },
            });
      if (error) throw new Error("ACTION_FAILED");
    } catch {
      setRequests(previous);
      Alert.alert(
        "Erreur",
        "L'action n'a pas pu être effectuée. Veuillez réessayer.",
      );
    }
  };

  const handleAction = (
    item: RegistrationRequest,
    action: "APPROVE" | "REJECT",
  ) => {
    Alert.alert(
      action === "APPROVE" ? "Valider" : "Refuser",
      `Voulez-vous vraiment ${
        action === "APPROVE" ? "valider" : "refuser"
      } cette inscription ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          style: action === "REJECT" ? "destructive" : "default",
          onPress: () => {
            performAction(item, action).catch(() => {});
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: RegistrationRequest }) => (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.cardHeader}>
        <View style={styles.badgeContainer}>
          <Clock size={12} color="#FF9800" />
          <AppText variant="caption" style={styles.badgeText}>
            EN ATTENTE
          </AppText>
        </View>
        <AppText variant="caption" style={{ color: theme.textSecondary }}>
          {item.date}
        </AppText>
      </View>

      <AppText variant="h3" style={[styles.marginTop8, { color: theme.text }]}>
        {item.dancerName}
      </AppText>
      <AppText
        variant="body"
        style={[styles.marginTop4, { color: theme.textSecondary }]}
      >
        {item.competitionName}
      </AppText>
      <AppText
        variant="caption"
        style={[styles.marginTop2, { color: theme.primary }]}
      >
        {item.category}
      </AppText>

      <View style={[styles.actionRow, { borderTopColor: theme.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.actionButton, styles.bgRedLight]}
          onPress={() => handleAction(item, "REJECT")}
        >
          <X size={20} color="#F44336" />
          <AppText variant="button" style={styles.textRedAction}>
            Refuser
          </AppText>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.actionButton, styles.bgGreenLight]}
          onPress={() => handleAction(item, "APPROVE")}
        >
          <Check size={20} color="#4CAF50" />
          <AppText variant="button" style={styles.textGreenAction}>
            Valider
          </AppText>
        </TouchableOpacity>
      </View>
    </View>
  );

  const header = (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title="Inscriptions"
      left={<BackButton onPress={() => navigation.goBack()} />}
      onHeightChange={setHeaderH}
    >
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher une inscription…"
        testID="club-registrations-search"
      />
    </PinnedHeader>
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View
          style={[styles.container, styles.center, { paddingTop: headerH + 8 }]}
        >
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
        {header}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlashList
        data={filteredRequests}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerH + 8, paddingBottom: insets.bottom + 20 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Clock
              size={48}
              color={theme.textSecondary}
              style={styles.marginBottom12}
            />
            <AppText
              variant="h3"
              align="center"
              style={[styles.marginBottom8, { color: theme.text }]}
            >
              {hasError ? "Chargement impossible" : "Aucune demande"}
            </AppText>
            <AppText
              variant="body"
              align="center"
              style={{ color: theme.textSecondary }}
            >
              {hasError
                ? "Impossible de charger les demandes d'inscription. Vérifiez votre connexion et réessayez."
                : registrationMode === "MEMBERS_AUTO_CONFIRM"
                  ? "Votre club est en mode inscription automatique, il n'y a donc aucune demande à valider."
                  : "Il n'y a aucune demande d'inscription en attente de validation."}
            </AppText>
          </View>
        }
      />
      {header}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
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
  },
  badgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255, 152, 0, 0.1)",
  },
  actionRow: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 50,
  },
  badgeText: { color: "#FF9800", marginLeft: 4, fontWeight: "bold" },
  marginTop8: { marginTop: 8 },
  marginTop4: { marginTop: 4 },
  marginTop2: { marginTop: 2 },
  bgRedLight: { backgroundColor: "rgba(244, 67, 54, 0.1)" },
  textRedAction: { color: "#F44336", marginLeft: 8 },
  bgGreenLight: { backgroundColor: "rgba(76, 175, 80, 0.1)" },
  textGreenAction: { color: "#4CAF50", marginLeft: 8 },
  marginBottom12: { marginBottom: 12 },
  marginBottom8: { marginBottom: 8 },
});
