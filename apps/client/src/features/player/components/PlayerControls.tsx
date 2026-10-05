import {
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { ContextRepeatMode } from "../context";
import { audioPlayerStyles as styles } from "./audio-player.styles";

interface PlayerControlsProps {
  currentTheme: AppTheme;
  isShuffle: boolean;
  isPlaying: boolean;
  repeatMode: ContextRepeatMode;
  toggleShuffle: () => void;
  handlePrev: () => void;
  handleNext: () => void;
  togglePlayback: () => void;
  toggleRepeat: () => void;
}

export const PlayerControls = ({
  currentTheme,
  isShuffle,
  isPlaying,
  repeatMode,
  toggleShuffle,
  handlePrev,
  handleNext,
  togglePlayback,
  toggleRepeat,
}: PlayerControlsProps) => (
  <View style={styles.controls}>
    {/* Shuffle */}
    <TouchableOpacity
      accessibilityRole="button"
      testID="audio-player-shuffle-button"
      onPress={toggleShuffle}
      style={styles.controlButton}
    >
      <Shuffle
        color={isShuffle ? currentTheme.primary : currentTheme.textSecondary}
        size={22}
      />
      {isShuffle && (
        <View
          style={[
            styles.dotIndicator,
            { backgroundColor: currentTheme.primary },
          ]}
        />
      )}
    </TouchableOpacity>

    <TouchableOpacity
      accessibilityRole="button"
      testID="audio-player-prev-button"
      onPress={handlePrev}
      style={styles.controlButton}
    >
      <SkipBack color={currentTheme.primary} size={32} />
    </TouchableOpacity>

    <TouchableOpacity
      testID="audio-player-play-button"
      accessibilityLabel={isPlaying ? "Pause" : "Lecture"}
      accessibilityHint="Met en pause ou reprend la musique"
      style={[
        styles.playButton,
        {
          backgroundColor: currentTheme.primary,
          shadowColor: currentTheme.primary,
        },
      ]}
      onPress={togglePlayback}
    >
      {isPlaying ? (
        <Pause color="#FFFFFF" size={32} fill="#FFFFFF" />
      ) : (
        <Play color="#FFFFFF" size={32} fill="#FFFFFF" />
      )}
    </TouchableOpacity>

    <TouchableOpacity
      accessibilityRole="button"
      testID="audio-player-next-button"
      onPress={handleNext}
      style={styles.controlButton}
    >
      <SkipForward color={currentTheme.primary} size={32} />
    </TouchableOpacity>

    {/* Repeat */}
    <TouchableOpacity
      accessibilityRole="button"
      testID="audio-player-repeat-button"
      onPress={toggleRepeat}
      style={styles.controlButton}
    >
      <Repeat
        color={
          repeatMode !== ContextRepeatMode.Off
            ? currentTheme.primary
            : currentTheme.textSecondary
        }
        size={22}
      />
      {repeatMode !== ContextRepeatMode.Off && (
        <View style={styles.repeatBadge}>
          {repeatMode === ContextRepeatMode.Track && (
            <AppText
              variant="caption"
              weight="bold"
              color={currentTheme.primary}
              style={styles.repeatOneText}
            >
              1
            </AppText>
          )}
        </View>
      )}
      {repeatMode !== ContextRepeatMode.Off && (
        <View
          style={[
            styles.dotIndicator,
            { backgroundColor: currentTheme.primary },
          ]}
        />
      )}
    </TouchableOpacity>
  </View>
);
