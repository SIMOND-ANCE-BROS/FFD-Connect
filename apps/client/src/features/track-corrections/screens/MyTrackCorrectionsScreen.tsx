import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Inbox } from "lucide-react-native";
import React, { useState } from "react";
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
import type { MyTrackCorrectionDto } from "../../../services/api/track-correction-api";
import { StatusBadge } from "../components/CorrectionChips";
import { useMyTrackCorrections } from "../hooks/useTrackCorrections";
import {
  formatClashList,
  formatCorrectionDate,
  reasonLabel,
} from "../utils/trackCorrections";

type Props = NativeStackScreenProps<RootStackParamList, "MyTrackCorrections">;

/** Valeurs proposées, en clair (« MPM : 52 », « Clashs : 0:45, 1:30 »). */
export function proposedSummary(item: MyTrackCorrectionDto): string[] {
  const { proposed } = item;
  const lines: string[] = [];
  if (proposed.title !== null) lines.push(`Titre : ${proposed.title}`);
  if (proposed.artist !== null) lines.push(`Artiste : ${proposed.artist}`);
  if (proposed.style !== null) lines.push(`Danse : ${proposed.style}`);
  if (proposed.bpm !== null) lines.push(`MPM : ${proposed.bpm}`);
  if (proposed.clashTimecodes !== null) {
    lines.push(`Clashs : ${formatClashList(proposed.clashTimecodes)}`);
  }
  return lines;
}

/** Suivi par l'utilisateur de ses propositions de correction. */
export const MyTrackCorrectionsScreen = ({ navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const {
    data,
    isLoading,
    isError,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyTrackCorrections();
  const items = data?.pages.flatMap((p) => p.data) ?? [];

  const renderItem = ({ item }: { item: MyTrackCorrectionDto }) => (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      testID={`my-correction-${item.id}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <AppText variant="body" weight="bold" color={theme.text}>
            {item.trackTitle}
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            {item.trackArtist}
          </AppText>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <AppText
        variant="caption"
        color={theme.textSecondary}
        style={styles.meta}
      >
        {reasonLabel(item.reason)} · {formatCorrectionDate(item.createdAt)}
      </AppText>
      {proposedSummary(item).map((line) => (
        <AppText key={line} variant="body" color={theme.text}>
          {line}
        </AppText>
      ))}
      {item.message ? (
        <AppText
          variant="caption"
          color={theme.textSecondary}
          style={styles.meta}
        >
          Votre commentaire : {item.message}
        </AppText>
      ) : null}
      {item.reviewComment ? (
        <View style={[styles.quote, { borderLeftColor: theme.primary }]}>
          <AppText variant="caption" color={theme.textSecondary}>
            Réponse de l&apos;administrateur
          </AppText>
          <AppText variant="body" color={theme.text}>
            {item.reviewComment}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={[styles.center, { paddingTop: headerH }]}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  } else if (isError) {
    body = (
      <View style={[styles.center, { paddingTop: headerH }]}>
        <AppText
          variant="body"
          color={theme.textSecondary}
          align="center"
          style={styles.errorText}
        >
          Impossible de charger vos propositions.
        </AppText>
        <AppButton
          title="Réessayer"
          variant="secondary"
          onPress={() => {
            void refetch();
          }}
          testID="my-corrections-retry"
        />
      </View>
    );
  } else {
    body = (
      <FlatList
        testID="my-corrections-list"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator
              color={theme.primary}
              style={styles.footer}
              testID="my-corrections-loading-more"
            />
          ) : null
        }
        contentContainerStyle={[
          styles.list,
          { paddingTop: headerH, paddingBottom: insets.bottom + 40 },
        ]}
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
          <View style={styles.empty} testID="my-corrections-empty">
            <Inbox size={44} color={theme.textSecondary} />
            <AppText
              variant="body"
              color={theme.textSecondary}
              align="center"
              style={styles.emptyText}
            >
              Vous n&apos;avez proposé aucune correction. Depuis le lecteur,
              touchez « Signaler / proposer une correction » ; dans la
              bibliothèque, appuyez longuement sur une musique.
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
      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Mes propositions"
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  errorText: { marginBottom: 16 },
  list: { paddingHorizontal: 16 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flex: { flex: 1 },
  meta: { marginTop: 6, marginBottom: 4 },
  quote: { marginTop: 10, paddingLeft: 10, borderLeftWidth: 3 },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 24 },
  emptyText: { marginTop: 12 },
  footer: { paddingVertical: 16 },
});
