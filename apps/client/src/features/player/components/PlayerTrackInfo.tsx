import { Heart, SlidersVertical } from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { TrackData } from "../types";
import { audioPlayerStyles as styles } from "./audio-player.styles";

interface PlayerTrackInfoProps {
  currentTheme: AppTheme;
  isDark: boolean;
  currentTrack: TrackData;
  isLiked: boolean;
  isBpmVisible: boolean;
  toggleLike: () => void;
  setIsBpmVisible: (visible: boolean) => void;
}

export const PlayerTrackInfo = ({
  currentTheme,
  isDark,
  currentTrack,
  isLiked,
  isBpmVisible,
  toggleLike,
  setIsBpmVisible,
}: PlayerTrackInfoProps) => (
  <View style={styles.trackInfoContainer}>
    {/* Like Button */}
    <TouchableOpacity
      testID="audio-player-like-button"
      accessibilityLabel={
        isLiked ? "Retirer des favoris" : "Ajouter aux favoris"
      }
      accessibilityHint="Ajoute ou retire cette musique de vos favoris"
      style={[
        styles.sideControl,
        isDark ? styles.controlDark : styles.controlLight,
      ]}
      onPress={toggleLike}
    >
      <Heart
        color={isLiked ? "#E91E63" : currentTheme.textSecondary}
        size={24}
        fill={isLiked ? "#E91E63" : "none"}
        strokeWidth={isLiked ? 0 : 2}
      />
    </TouchableOpacity>

    {/* Center Info */}
    <View style={styles.trackTextContainer}>
      <AppText
        variant="h2"
        weight="bold"
        style={styles.textCenter}
        numberOfLines={1}
        color={currentTheme.text}
      >
        {currentTrack.title}
      </AppText>
      <AppText
        variant="body"
        color={currentTheme.textSecondary}
        style={styles.textCenter}
        numberOfLines={1}
      >
        {currentTrack.style ? `${currentTrack.style} • ` : ""}
        {currentTrack.artist}
      </AppText>
    </View>

    {/* BPM Toggle */}
    <TouchableOpacity
      testID="audio-player-bpm-toggle-button"
      accessibilityLabel="Afficher les contrôles de tempo (MPM)"
      accessibilityHint="Affiche les réglages pour modifier la vitesse de lecture"
      onPress={() => setIsBpmVisible(!isBpmVisible)}
      style={[
        styles.sideControl,
        isBpmVisible
          ? isDark
            ? styles.controlActiveDark
            : styles.controlActiveLight
          : isDark
            ? styles.controlDark
            : styles.controlLight,
      ]}
    >
      <SlidersVertical
        size={24}
        color={isBpmVisible ? currentTheme.primary : currentTheme.textSecondary}
      />
    </TouchableOpacity>
  </View>
);
