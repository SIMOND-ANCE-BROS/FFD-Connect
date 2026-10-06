import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Bell, CheckCheck, Inbox } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import {
  Notification,
  useNotificationsLogic,
} from "../hooks/useNotificationsLogic";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

/**
 * Destination d'une notification, déduite de sa charge utile.
 *
 * Volontairement tolérant : `data` est un `Json?` rempli par le producteur, et
 * un type ajouté côté serveur ne doit pas provoquer de crash sur un client plus
 * ancien. Ce qu'on ne reconnaît pas ne mène nulle part, silencieusement — ce
 * qui reste préférable à une navigation vers un écran inexistant.
 */
const competitionIdOf = (data: Notification["data"]): string | null => {
  const raw = data?.competitionId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

export const NotificationsScreen = ({ navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const openTarget = useCallback(
    (item: Notification) => {
      const competitionId = competitionIdOf(item.data);
      if (competitionId)
        navigation.navigate("CompetitionDetail", { competitionId });
    },
    [navigation],
  );
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const { state, actions } = useNotificationsLogic();
  const { notifications, loading, refreshing } = state;
  const { onRefresh, onMarkAsRead, onReadAll } = actions;

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      accessibilityRole="button"
      style={[
        styles.card,
        { backgroundColor: theme.surface },
        item.isRead ? styles.readBorder : { borderColor: theme.primary },
        !item.isRead && styles.unreadCard,
      ]}
      onPress={() => {
        if (!item.isRead) onMarkAsRead(item.id).catch(() => {});
        openTarget(item);
      }}
      activeOpacity={0.7}
      testID={`notifications-card-${item.id}`}
    >
      <View
        style={[
          styles.iconBox,
          {
            backgroundColor: item.isRead
              ? theme.background
              : `${theme.primary}20`,
          },
        ]}
      >
        <Bell
          size={20}
          color={item.isRead ? theme.textSecondary : theme.primary}
        />
      </View>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <AppText variant="body" weight="bold" style={{ color: theme.text }}>
            {item.title}
          </AppText>
          <AppText variant="caption" style={{ color: theme.textSecondary }}>
            {new Date(item.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "short",
            })}
          </AppText>
        </View>
        <AppText variant="body" style={styles.bodyText}>
          {item.body}
        </AppText>
      </View>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title="Notifications"
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
      right={
        notifications.some((n) => !n.isRead) ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              onReadAll().catch(() => {});
            }}
            style={styles.readAllButton}
            testID="notifications-read-all-button"
          >
            <CheckCheck size={20} color={theme.primary} />
            <AppText variant="caption" weight="bold" style={styles.readAllText}>
              Tout lire
            </AppText>
          </TouchableOpacity>
        ) : undefined
      }
    />
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
      testID="notifications-header"
    >
      {loading ? (
        <View style={[styles.center, { paddingTop: headerH + 8 }]}>
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              progressViewOffset={headerH}
              onRefresh={onRefresh}
              tintColor={theme.primary}
            />
          }
          contentContainerStyle={{ ...styles.list, paddingTop: headerH + 8 }}
          ListEmptyComponent={
            <View style={styles.empty} testID="notifications-empty-state">
              <Inbox
                size={48}
                color={theme.textSecondary}
                style={styles.emptyIcon}
              />
              <AppText
                variant="h3"
                align="center"
                style={[styles.emptyTitle, { color: theme.text }]}
              >
                Aucune notification
              </AppText>
              <AppText
                variant="body"
                color={theme.textSecondary}
                align="center"
              >
                Vous retrouverez ici vos alertes de compétition, résultats et
                messages officiels.
              </AppText>
            </View>
          }
        />
      )}
      {renderHeader()}
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
  },
  backButton: { padding: 4 },
  readAllButton: { flexDirection: "row", alignItems: "center", padding: 8 },
  readAllText: { color: "#007AFF", marginLeft: 4 },
  title: { flex: 1, marginLeft: 8 },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  readBorder: {
    borderColor: "transparent",
  },
  unreadCard: {
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  bodyText: { color: "#666", marginTop: 4 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  content: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 100,
    paddingHorizontal: 40,
  },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: { marginBottom: 8 },
});
