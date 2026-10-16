import { BlurView } from "expo-blur";
import { GripVertical, Trash2, X } from "lucide-react-native";
import React from "react";
import {
  AccessibilityActionEvent,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator as ScaleDecoratorBase,
} from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { joinA11yLabel } from "../../../utils/a11y";
import { announce } from "../../../utils/announce";
import { TrackData } from "../types";
import { audioPlayerStyles as styles } from "./audio-player.styles";

const ScaleDecorator = ScaleDecoratorBase as React.FC<{
  activeScale?: number;
  children?: React.ReactNode;
}>;

interface PlayerQueueModalProps {
  currentTheme: AppTheme;
  isDark: boolean;
  isQueueVisible: boolean;
  tracks: TrackData[];
  currentTrackId: string;
  closeQueue: () => void;
  playQueueTrack: (trackId: string) => Promise<void>;
  removeQueueTrack: (trackId: string) => void;
  moveQueueTrack: (from: number, to: number) => void;
}

export const PlayerQueueModal = ({
  currentTheme,
  isDark,
  isQueueVisible,
  tracks,
  currentTrackId,
  closeQueue,
  playQueueTrack,
  removeQueueTrack,
  moveQueueTrack,
}: PlayerQueueModalProps) => {
  const renderItem = ({
    item,
    getIndex,
    drag,
    isActive,
  }: RenderItemParams<TrackData>) => {
    const isCurrent = item.id === currentTrackId;
    const index = getIndex() ?? -1;
    // Screen-reader alternative to drag-and-drop, and to the nested remove
    // button: the row is one accessible element, so VoiceOver cannot reach
    // the buttons inside it — they are exposed as actions instead.
    const accessibilityActions = [
      ...(index > 0 ? [{ name: "moveUp", label: "Monter" }] : []),
      ...(index >= 0 && index < tracks.length - 1
        ? [{ name: "moveDown", label: "Descendre" }]
        : []),
      { name: "remove", label: "Retirer de la file" },
    ];
    const move = (to: number) => {
      moveQueueTrack(index, to);
      announce(`${item.title}, position ${to + 1} sur ${tracks.length}`);
    };
    const onAccessibilityAction = (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case "moveUp":
          move(index - 1);
          break;
        case "moveDown":
          move(index + 1);
          break;
        case "remove":
          removeQueueTrack(item.id);
          announce(`${item.title} retiré de la file`);
          break;
        default:
          break;
      }
    };

    return (
      <ScaleDecorator>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={joinA11yLabel([
            item.title,
            item.artist,
            isCurrent && "en lecture",
            index >= 0 && `${index + 1} sur ${tracks.length}`,
          ])}
          accessibilityHint="Lance ce titre. Actions disponibles pour le déplacer ou le retirer de la file."
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          testID={`queue-track-${item.id}`}
          style={[
            styles.queueItem,
            { borderBottomColor: currentTheme.border },
            isActive && styles.queueItemDragging,
          ]}
          disabled={isActive}
          onPress={() => {
            playQueueTrack(item.id).catch(() => {});
          }}
          onLongPress={drag}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Déplacer ${item.title}`}
            accessibilityHint="Maintenez et faites glisser pour changer l'ordre de la file"
            testID={`queue-drag-${item.id}`}
            onPressIn={drag}
            // Drag gesture only: the row's « Monter / Descendre » actions
            // are the screen-reader equivalent.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.queueHandle}
          >
            <GripVertical size={18} color={currentTheme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.queueItemInfo}>
            <AppText
              style={[
                styles.queueItemTitle,
                {
                  color: isCurrent ? currentTheme.primary : currentTheme.text,
                },
              ]}
              numberOfLines={1}
            >
              {item.title}
            </AppText>
            <AppText
              style={[
                styles.queueItemArtist,
                { color: currentTheme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {item.artist}
            </AppText>
          </View>
          <View style={styles.queueActions}>
            {isCurrent && (
              <AppText
                variant="caption"
                color={currentTheme.primary}
                maxFontSizeMultiplier={1.5}
              >
                En lecture
              </AppText>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Retirer ${item.title} de la file`}
              accessibilityHint="Enlève ce titre de la file d'attente"
              testID={`queue-remove-${item.id}`}
              hitSlop={12}
              style={styles.queueIconButton}
              onPress={() => removeQueueTrack(item.id)}
            >
              <Trash2 size={18} color={currentTheme.textSecondary} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  return (
    <Modal
      visible={isQueueVisible}
      transparent
      animationType="slide"
      onRequestClose={closeQueue}
    >
      {/* A Modal renders outside the app root: gestures (drag-and-drop) need
          their own root view here, notably on Android. */}
      <GestureHandlerRootView style={styles.queueOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer la file d'attente"
          accessibilityHint="Revient au lecteur"
          style={StyleSheet.absoluteFill}
          onPress={closeQueue}
        >
          <BlurView
            style={StyleSheet.absoluteFill}
            tint={isDark ? "dark" : "light"}
            intensity={20}
            pointerEvents="none"
          />
        </Pressable>
        <View
          onAccessibilityEscape={closeQueue}
          style={[
            styles.queueContainer,
            { backgroundColor: currentTheme.surface },
          ]}
        >
          <View style={styles.queueHeader}>
            <AppText
              style={[styles.queueTitle, { color: currentTheme.text }]}
              accessibilityRole="header"
            >
              File d'attente
            </AppText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme la file d'attente"
              hitSlop={12}
              onPress={closeQueue}
            >
              <X size={20} color={currentTheme.textSecondary} />
            </TouchableOpacity>
          </View>
          {tracks.length === 0 ? (
            <View style={styles.queueEmpty}>
              <AppText color={currentTheme.textSecondary}>
                Aucun titre dans la file
              </AppText>
            </View>
          ) : (
            <>
              {tracks.length > 1 && (
                <AppText
                  variant="caption"
                  color={currentTheme.textSecondary}
                  style={styles.queueHint}
                >
                  Maintenez un titre pour le déplacer.
                </AppText>
              )}
              <DraggableFlatList
                data={tracks}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                onDragEnd={({ from, to }) => moveQueueTrack(from, to)}
                containerStyle={styles.queueList}
              />
            </>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};
