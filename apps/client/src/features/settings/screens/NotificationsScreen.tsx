import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Bell, CheckCheck, Inbox, Trash2 } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { trackCorrectionTargetOf } from "../../track-corrections/utils/notificationTarget";
import {
  Notification,
  useNotificationsLogic,
} from "../hooks/useNotificationsLogic";
import { notificationTargetOf } from "../services/notificationTarget";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

export const NotificationsScreen = ({ navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * La charge utile est lue par `notificationTargetOf`, PARTAGÉ avec le tap sur
   * la push système. Deux lectures séparées avaient déjà divergé : l'une
   * naviguait, l'autre ne faisait rien.
   *
   * Ici une destination inconnue ne fait rien — on est déjà dans le centre de
   * notifications, il n'y a nulle part de plus pertinent où aller.
   */
  const openTarget = useCallback(
    (item: Notification) => {
      const target = notificationTargetOf(item.data);
      if (target?.screen === "CompetitionDetail") {
        navigation.navigate("CompetitionDetail", target.params);
      }
    },
    [navigation],
  );
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const { state, actions } = useNotificationsLogic();
  const { notifications, loading, refreshing } = state;
  const { onRefresh, onMarkAsRead, onReadAll, onDelete, onDeleteAll } = actions;

  // Propositions de correction de musique : file admin ou « Mes propositions ».
  const openTrackCorrection = useCallback(
    (item: Notification) => {
      const target = trackCorrectionTargetOf(item.data);
      if (target?.screen === "TrackCorrectionsReview") {
        navigation.navigate("TrackCorrectionsReview", target.params);
      } else if (target?.screen === "MyTrackCorrections") {
        navigation.navigate("MyTrackCorrections");
      }
    },
    [navigation],
  );

  /**
   * « Tout effacer » demande confirmation : c'est la seule action de l'écran
   * qui détruise quelque chose d'irrécupérable, et elle est à un doigt de la
   * liste. La suppression unitaire, elle, n'en demande pas — le geste est
   * délibéré et ne coûte qu'une ligne.
   */
  const confirmDeleteAll = useCallback(() => {
    Alert.alert(
      "Tout effacer",
      "Supprimer toutes vos notifications ? Cette action est définitive.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Tout effacer",
          style: "destructive",
          onPress: () => {
            onDeleteAll().catch(() => {});
          },
        },
      ],
    );
  }, [onDeleteAll]);

  // La carte n'est plus elle-même cliquable : zone d'ouverture et corbeille
  // sont deux frères sous un conteneur inerte. Imbriquer la corbeille dans un
  // TouchableOpacity la rendrait invisible aux lecteurs d'écran, qui fusionnent
  // un élément accessible et ses enfants en un seul.
  const renderItem = ({ item }: { item: Notification }) => (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface },
        item.isRead ? styles.readBorder : { borderColor: theme.primary },
        !item.isRead && styles.unreadCard,
      ]}
    >
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.cardMain}
        onPress={() => {
          if (!item.isRead) onMarkAsRead(item.id).catch(() => {});
          openTarget(item);
          openTrackCorrection(item);
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
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Supprimer la notification ${item.title}`}
        accessibilityHint="Retire définitivement cette notification de la liste"
        onPress={() => {
          onDelete(item.id).catch(() => {});
        }}
        style={styles.deleteButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID={`notifications-delete-${item.id}`}
      >
        <Trash2 size={18} color={theme.textSecondary} />
      </TouchableOpacity>
    </View>
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
        <View style={[styles.center, { paddingTop: headerH }]}>
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
          contentContainerStyle={{ ...styles.list, paddingTop: headerH }}
          ListFooterComponent={
            // En pied de liste, et non dans l'en-tête à côté de « Tout lire » :
            // une action destructive n'a pas à être à portée de pouce
            // permanente, et l'en-tête n'a pas la place pour un second libellé
            // sans repousser le titre hors de l'écran.
            notifications.length > 0 ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={confirmDeleteAll}
                style={styles.clearAllButton}
                testID="notifications-clear-all-button"
              >
                <Trash2 size={16} color={theme.danger} />
                <AppText
                  variant="caption"
                  weight="bold"
                  style={[styles.clearAllText, { color: theme.danger }]}
                >
                  Tout effacer
                </AppText>
              </TouchableOpacity>
            ) : null
          }
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
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  // `flex: 1` et non `flexShrink` : la zone d'ouverture doit prendre la place
  // restante pour que la corbeille reste collée au bord droit, quelle que soit
  // la longueur du titre.
  cardMain: { flex: 1, flexDirection: "row", alignItems: "center" },
  deleteButton: { padding: 8, marginLeft: 4 },
  clearAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  clearAllText: { marginLeft: 6 },
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
