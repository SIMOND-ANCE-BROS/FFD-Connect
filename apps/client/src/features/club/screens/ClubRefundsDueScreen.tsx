import { useNavigation } from "@react-navigation/native";
import { FlashList } from "@shopify/flash-list";
import { ReceiptEuro } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
// Side-effect : configure le client OpenAPI généré (baseUrl + auth + refresh).
import "../../../api/client";
import { clubRefundsDueControllerList } from "../../../api/generated/sdk.gen";
import type { ClubRefundDueDto } from "../../../api/generated/types.gen";

const PAGE_SIZE = 20;

const euroFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

/** Montant d'un paiement en euros ; vide si le tarif n'est pas connu. */
export const formatRefundAmount = (cents: number | null): string =>
  cents === null ? "" : euroFormatter.format(cents / 100);

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/**
 * Remboursements dus par le club organisateur (#516) : paiements HelloAsso
 * reçus sans place attribuée (paiement tardif, en double, ou sur un paiement
 * remplacé). Lecture seule : le club rembourse depuis son espace HelloAsso,
 * et la ligne disparaît quand HelloAsso confirme le remboursement.
 */
export const ClubRefundsDueScreen = () => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [refunds, setRefunds] = useState<ClubRefundDueDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [headerH, setHeaderH] = useState(insets.top + 80);
  const isMounted = useRef(true);

  const loadPage = useCallback(async (skip: number) => {
    const { data, error } = await clubRefundsDueControllerList({
      query: { skip, take: PAGE_SIZE },
    });
    if (!isMounted.current) return;
    if (error || !data) {
      // Une page suivante en échec garde ce qui est déjà affiché.
      if (skip === 0) setHasError(true);
      setHasMore(false);
      return;
    }
    setRefunds((prev) => (skip === 0 ? data.data : [...prev, ...data.data]));
    setHasMore(data.meta.hasMore);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    loadPage(0)
      .catch(() => {
        if (isMounted.current) setHasError(true);
      })
      .finally(() => {
        if (isMounted.current) setLoading(false);
      });
    return () => {
      isMounted.current = false;
    };
  }, [loadPage]);

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    loadPage(refunds.length)
      .catch(() => setHasMore(false))
      .finally(() => {
        if (isMounted.current) setLoadingMore(false);
      });
  };

  const renderItem = ({ item }: { item: ClubRefundDueDto }) => {
    const count = item.helloAssoCheckoutIntentIds.length;
    const amount = formatRefundAmount(item.amountCents);
    const dancer = `${item.dancer.firstName} ${item.dancer.lastName}`.trim();
    return (
      <View
        style={[styles.card, { backgroundColor: theme.surface }]}
        testID={`club-refund-${item.bookingId}`}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badge}>
            <AppText variant="caption" style={styles.badgeText}>
              À REMBOURSER
            </AppText>
          </View>
          <AppText variant="caption" style={{ color: theme.textSecondary }}>
            Depuis le {formatDate(item.refundOwedAt)}
          </AppText>
        </View>

        <AppText variant="h3" style={[styles.mt8, { color: theme.text }]}>
          {dancer}
        </AppText>
        <AppText
          variant="body"
          style={[styles.mt4, { color: theme.textSecondary }]}
        >
          {item.competition.title} · {formatDate(item.competition.date)}
        </AppText>
        {item.seatNumber !== null && (
          <AppText
            variant="caption"
            style={[styles.mt4, { color: theme.textSecondary }]}
          >
            Place {item.seatNumber}
          </AppText>
        )}
        <AppText variant="body" style={[styles.mt8, { color: theme.text }]}>
          {count > 1
            ? `${count} paiements${amount ? ` de ${amount}` : ""} à rembourser`
            : `1 paiement${amount ? ` de ${amount}` : ""} à rembourser`}
        </AppText>
        <AppText
          variant="caption"
          selectable
          style={[styles.mt4, { color: theme.primary }]}
        >
          {count > 1 ? "Références HelloAsso : " : "Référence HelloAsso : "}
          {item.helloAssoCheckoutIntentIds.join(", ")}
        </AppText>
      </View>
    );
  };

  const header = (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title="Remboursements"
      left={<BackButton onPress={() => navigation.goBack()} />}
      onHeightChange={setHeaderH}
    />
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View
          style={[styles.container, styles.center, { paddingTop: headerH }]}
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
        data={refunds}
        renderItem={renderItem}
        keyExtractor={(item) => item.bookingId}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerH, paddingBottom: insets.bottom + 20 },
        ]}
        ListHeaderComponent={
          refunds.length > 0 ? (
            <AppText
              variant="body"
              style={[styles.intro, { color: theme.textSecondary }]}
              testID="club-refunds-intro"
            >
              Ces paiements ont été reçus sans qu'une place puisse être
              attribuée. Remboursez-les depuis votre espace HelloAsso : ils
              disparaîtront d'ici dès que HelloAsso aura confirmé le
              remboursement.
            </AppText>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={theme.primary} style={styles.mt8} />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ReceiptEuro
              size={48}
              color={theme.textSecondary}
              style={styles.mb12}
            />
            <AppText
              variant="h3"
              align="center"
              style={[styles.mb8, { color: theme.text }]}
            >
              {hasError ? "Chargement impossible" : "Aucun remboursement dû"}
            </AppText>
            <AppText
              variant="body"
              align="center"
              style={{ color: theme.textSecondary }}
            >
              {hasError
                ? "Impossible de charger les remboursements. Vérifiez votre connexion et réessayez."
                : "Tous les paiements reçus pour vos compétitions correspondent à une place."}
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
  center: { justifyContent: "center", alignItems: "center" },
  listContent: { padding: 20 },
  intro: { marginBottom: 16 },
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
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(244, 67, 54, 0.1)",
  },
  badgeText: { color: "#F44336", fontWeight: "bold" },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 50,
  },
  mt8: { marginTop: 8 },
  mt4: { marginTop: 4 },
  mb12: { marginBottom: 12 },
  mb8: { marginBottom: 8 },
});
