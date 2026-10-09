import { Flag, ListEnd, ListStart, Pencil } from "lucide-react-native";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../../components/AppText";
import { radii } from "../../../../constants/radii";
import { AppTheme } from "../../../../context/ThemeContext";
import { TrackData } from "../../context/PlayerContext";

/** Role-dependent extra action of the sheet (edit / propose a correction). */
export type TrackSheetExtraAction = "edit" | "report";

interface TrackActionsSheetProps {
  visible: boolean;
  /** Kept while the sheet slides out so its content does not blank. */
  track: TrackData | null;
  currentTheme: AppTheme;
  extraAction: TrackSheetExtraAction | null;
  onPlayNext: (track: TrackData) => void;
  onAddToQueue: (track: TrackData) => void;
  onExtraAction: (track: TrackData) => void;
  onClose: () => void;
  /** iOS: fired once the sheet is fully hidden (see LibraryScreen). */
  onDismiss?: () => void;
}

const EXTRA_ACTIONS: Record<
  TrackSheetExtraAction,
  { label: string; hint: string; Icon: typeof Pencil }
> = {
  edit: {
    label: "Modifier le titre",
    hint: "Ouvre l'édition des informations du titre",
    Icon: Pencil,
  },
  report: {
    label: "Proposer une correction",
    hint: "Signale une erreur sur ce titre à l'équipe",
    Icon: Flag,
  },
};

/**
 * Bottom sheet opened by a long-press on a library track: queue actions
 * (« Lire ensuite », « Ajouter à la file ») plus the role-dependent action that
 * long-press used to trigger directly.
 */
export const TrackActionsSheet = ({
  visible,
  track,
  currentTheme,
  extraAction,
  onPlayNext,
  onAddToQueue,
  onExtraAction,
  onClose,
  onDismiss,
}: TrackActionsSheetProps) => {
  const insets = useSafeAreaInsets();

  const rows: {
    key: string;
    label: string;
    hint: string;
    Icon: typeof Pencil;
    onPress: (t: TrackData) => void;
  }[] = [
    {
      key: "play-next",
      label: "Lire ensuite",
      hint: "Ce titre sera lu juste après le titre en cours",
      Icon: ListStart,
      onPress: onPlayNext,
    },
    {
      key: "add-to-queue",
      label: "Ajouter à la file",
      hint: "Ajoute ce titre à la fin de la file d'attente",
      Icon: ListEnd,
      onPress: onAddToQueue,
    },
    ...(extraAction
      ? [
          {
            key: extraAction,
            ...EXTRA_ACTIONS[extraAction],
            onPress: onExtraAction,
          },
        ]
      : []),
  ];

  return (
    <Modal
      visible={visible && track !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      testID="track-actions-sheet-modal"
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          testID="track-actions-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          accessibilityHint="Ferme le menu du titre"
        />
        <View
          testID="track-actions-sheet"
          style={[
            styles.card,
            {
              backgroundColor: currentTheme.surface,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            },
          ]}
        >
          {track && (
            <>
              <AppText
                variant="h3"
                color={currentTheme.text}
                accessibilityRole="header"
                numberOfLines={1}
              >
                {track.title}
              </AppText>
              <AppText
                variant="caption"
                color={currentTheme.textSecondary}
                numberOfLines={1}
                style={styles.subtitle}
              >
                {track.artist}
              </AppText>
              {rows.map(({ key, label, hint, Icon, onPress }) => (
                <TouchableOpacity
                  key={key}
                  testID={`track-action-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={hint}
                  style={[styles.row, { borderTopColor: currentTheme.border }]}
                  onPress={() => onPress(track)}
                >
                  <Icon size={20} color={currentTheme.text} />
                  <AppText variant="body" color={currentTheme.text}>
                    {label}
                  </AppText>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  card: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  subtitle: {
    marginTop: 2,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
