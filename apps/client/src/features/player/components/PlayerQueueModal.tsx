import { BlurView } from "expo-blur";
import { Trash2, X } from "lucide-react-native";
import React from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { TrackData } from "../types";
import { audioPlayerStyles as styles } from "./audio-player.styles";

interface PlayerQueueModalProps {
  currentTheme: AppTheme;
  isDark: boolean;
  isQueueVisible: boolean;
  tracks: TrackData[];
  currentTrackId: string;
  closeQueue: () => void;
  playQueueTrack: (trackId: string) => Promise<void>;
  removeQueueTrack: (trackId: string) => void;
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
}: PlayerQueueModalProps) => (
  <Modal
    visible={isQueueVisible}
    transparent
    animationType="slide"
    onRequestClose={closeQueue}
  >
    <View style={styles.queueOverlay}>
      <Pressable
        accessibilityRole="button"
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
        style={[
          styles.queueContainer,
          { backgroundColor: currentTheme.surface },
        ]}
      >
        <View style={styles.queueHeader}>
          <AppText style={[styles.queueTitle, { color: currentTheme.text }]}>
            File d'attente
          </AppText>
          <TouchableOpacity accessibilityRole="button" onPress={closeQueue}>
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
          <FlatList
            data={tracks}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isCurrent = item.id === currentTrackId;
              return (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.queueItem,
                    { borderBottomColor: currentTheme.border },
                  ]}
                  onPress={() => {
                    playQueueTrack(item.id).catch(() => {});
                  }}
                >
                  <View style={styles.queueItemInfo}>
                    <AppText
                      style={[
                        styles.queueItemTitle,
                        {
                          color: isCurrent
                            ? currentTheme.primary
                            : currentTheme.text,
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
                      <AppText variant="caption" color={currentTheme.primary}>
                        En lecture
                      </AppText>
                    )}
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => removeQueueTrack(item.id)}
                    >
                      <Trash2 size={18} color={currentTheme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </View>
  </Modal>
);
