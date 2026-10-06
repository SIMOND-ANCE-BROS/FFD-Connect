import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Inbox } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import type {
  TrackCorrectionAdminDto,
  TrackCorrectionStatus,
} from "../../../services/api/track-correction-api";
import { useAuthStore } from "../../../stores/auth.store";
import { ChoiceChip, chipStyles } from "../components/CorrectionChips";
import { CorrectionReviewCard } from "../components/CorrectionReviewCard";
import { useAdminTrackCorrections } from "../hooks/useTrackCorrections";

type Props = NativeStackScreenProps<
  RootStackParamList,
  "TrackCorrectionsReview"
>;

const FILTERS: { value: TrackCorrectionStatus; label: string }[] = [
  { value: "PENDING", label: "En attente" },
  { value: "APPROVED", label: "Validées" },
  { value: "REJECTED", label: "Refusées" },
];

const EMPTY_LABELS: Record<TrackCorrectionStatus, string> = {
  PENDING: "Aucune proposition en attente.",
  APPROVED: "Aucune proposition validée.",
  REJECTED: "Aucune proposition refusée.",
};

/**
 * File de modération des propositions de correction (ADMIN). Les plus
 * anciennes en attente d'abord ; ouverte depuis une notification, la
 * proposition concernée est remontée en tête et mise en avant.
 */
export const TrackCorrectionsReviewScreen = ({ navigation, route }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 110);
  const role = useAuthStore((s) => s.role);
  const isAdmin = role === "ADMIN";
  const focusedId = route.params?.correctionId;
  const [status, setStatus] = useState<TrackCorrectionStatus>("PENDING");

  const { data, isLoading, isError, isRefetching, refetch } =
    useAdminTrackCorrections(status, isAdmin);

  const items = useMemo<TrackCorrectionAdminDto[]>(() => {
    const list = data?.data ?? [];
    if (!focusedId) return list;
    const focused = list.find((c) => c.id === focusedId);
    return focused
      ? [focused, ...list.filter((c) => c.id !== focusedId)]
      : list;
  }, [data, focusedId]);

  const header = (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title="Propositions de correction"
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
    >
      {isAdmin ? (
        <View style={[chipStyles.grid, styles.filters]}>
          {FILTERS.map((f) => (
            <ChoiceChip
              key={f.value}
              label={f.label}
              selected={status === f.value}
              onPress={() => setStatus(f.value)}
              testID={`corrections-filter-${f.value}`}
              accessibilityHint="Filtre les propositions par statut"
            />
          ))}
        </View>
      ) : null}
    </PinnedHeader>
  );

  let body: React.ReactNode;
  if (!isAdmin) {
    body = (
      <View style={[styles.center, { paddingTop: headerH + 24 }]}>
        <AppText variant="body" color={theme.textSecondary} align="center">
          Accès réservé aux administrateurs.
        </AppText>
      </View>
    );
  } else if (isLoading) {
    body = (
      <View style={[styles.center, { paddingTop: headerH + 24 }]}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  } else if (isError) {
    body = (
      <View style={[styles.center, { paddingTop: headerH + 24 }]}>
        <AppText
          variant="body"
          color={theme.textSecondary}
          align="center"
          style={styles.errorText}
        >
          Impossible de charger les propositions.
        </AppText>
        <AppButton
          title="Réessayer"
          variant="secondary"
          onPress={() => {
            void refetch();
          }}
          testID="corrections-retry"
        />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CorrectionReviewCard item={item} focused={item.id === focusedId} />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingTop: headerH + 8, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            progressViewOffset={headerH}
            onRefresh={() => {
              void refetch();
            }}
            tintColor={theme.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="corrections-empty">
            <Inbox size={44} color={theme.textSecondary} />
            <AppText
              variant="body"
              color={theme.textSecondary}
              align="center"
              style={styles.emptyText}
            >
              {EMPTY_LABELS[status]}
            </AppText>
          </View>
        }
      />
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      {body}
      {header}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  filters: { paddingHorizontal: 16, paddingBottom: 8 },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  errorText: { marginBottom: 16 },
  list: { paddingHorizontal: 16 },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { marginTop: 12 },
});
