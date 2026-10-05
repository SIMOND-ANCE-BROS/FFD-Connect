import Slider from "@react-native-community/slider";
import { Lock, Unlock } from "lucide-react-native";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { theme } from "../../../theme";
import { audioPlayerStyles as styles } from "./audio-player.styles";

interface PlayerBpmControlsProps {
  currentTheme: AppTheme;
  isDark: boolean;
  bpm: number;
  bpmDiff: number;
  minMpm: number;
  maxMpm: number;
  changeBpm: (value: number) => Promise<void>;
  resetBpm: () => Promise<void>;
  // Tempo lock (lifted to the player logic so it persists across track changes).
  locked: boolean;
  onToggleLock: () => void;
}

export const PlayerBpmControls = ({
  currentTheme,
  isDark,
  bpm,
  bpmDiff,
  minMpm,
  maxMpm,
  changeBpm,
  resetBpm,
  locked,
  onToggleLock,
}: PlayerBpmControlsProps) => {
  return (
    <View
      style={[
        styles.bpmPanel,
        isDark ? styles.bpmPanelDark : styles.bpmPanelLight,
        { borderColor: currentTheme.border },
      ]}
    >
      <View style={styles.bpmDisplayRow}>
        <AppText
          variant="caption"
          weight="bold"
          color={currentTheme.textSecondary}
          style={styles.tempoLabel}
        >
          TEMPO
        </AppText>
        <View style={styles.rowBaseline}>
          <Text style={[styles.bpmValueSmall, { color: currentTheme.primary }]}>
            {bpm.toFixed(1)}
          </Text>
          <AppText
            variant="caption"
            color={currentTheme.textSecondary}
            style={styles.marginLeft4}
          >
            MPM
          </AppText>
          <AppText
            style={[
              styles.bpmDiff,
              {
                color:
                  bpmDiff > 0
                    ? theme.colors.success
                    : bpmDiff < 0
                      ? theme.colors.error
                      : currentTheme.textSecondary,
              },
            ]}
          >
            {bpmDiff > 0 ? "+" : ""}
            {bpmDiff.toFixed(1)}
          </AppText>
        </View>
        <TouchableOpacity
          onPress={onToggleLock}
          testID="audio-player-bpm-lock-button"
          accessibilityRole="button"
          accessibilityLabel={
            locked ? "Déverrouiller le tempo" : "Verrouiller le tempo"
          }
          accessibilityHint="Empêche toute modification accidentelle du tempo"
          style={styles.tempoLockButton}
        >
          {locked ? (
            <Lock size={18} color={currentTheme.primary} />
          ) : (
            <Unlock size={18} color={currentTheme.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      <Slider
        style={styles.speedSliderSmall}
        value={bpm}
        minimumValue={minMpm}
        maximumValue={maxMpm}
        step={0.1}
        disabled={locked}
        thumbTintColor={
          locked ? currentTheme.textSecondary : currentTheme.primary
        }
        minimumTrackTintColor={
          locked ? currentTheme.border : currentTheme.primary
        }
        maximumTrackTintColor={currentTheme.border}
        onValueChange={(value: number) => {
          if (locked) return;
          changeBpm(value).catch(() => {});
        }}
      />

      <View style={styles.speedMarkersSmall}>
        <TouchableOpacity
          testID="audio-player-bpm-min-button"
          accessibilityLabel="MPM minimum"
          accessibilityHint="Règle la vitesse au minimum"
          disabled={locked}
          onPress={() => {
            changeBpm(minMpm).catch(() => {});
          }}
        >
          <Text
            style={[styles.markerText, { color: currentTheme.textSecondary }]}
          >
            Min
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="audio-player-bpm-reset-button"
          accessibilityLabel="Réinitialiser le MPM"
          accessibilityHint="Rétablit la vitesse originale de la musique"
          disabled={locked}
          onPress={() => {
            resetBpm().catch(() => {});
          }}
          style={styles.resetButtonSmall}
        >
          <Text
            style={[
              styles.markerText,
              styles.bold,
              { color: currentTheme.primary },
            ]}
          >
            RESET
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="audio-player-bpm-max-button"
          accessibilityLabel="MPM maximum"
          accessibilityHint="Règle la vitesse au maximum"
          disabled={locked}
          onPress={() => {
            changeBpm(maxMpm).catch(() => {});
          }}
        >
          <Text
            style={[styles.markerText, { color: currentTheme.textSecondary }]}
          >
            Max
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
