import Slider from "@react-native-community/slider";
import { Lock, Unlock } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { theme } from "../../../theme";
import { audioPlayerStyles as styles } from "./audio-player.styles";

/** Minimum delay between two playback-rate updates while dragging. */
export const BPM_DRAG_THROTTLE_MS = 120;

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
  // While dragging, the slider owns its value: feeding the store value back
  // through `value` on every tick made the thumb lag behind the finger, and
  // each tick re-rendered the player and crossed the native bridge (setRate).
  // The displayed MPM follows the finger; the rate is applied at most every
  // BPM_DRAG_THROTTLE_MS and committed exactly on release.
  const [dragValue, setDragValue] = useState<number | null>(null);
  // Value handed to the native slider, frozen for the whole drag so the
  // throttled store updates never yank the thumb back.
  const frozenValueRef = useRef(bpm);
  const lastApplyRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    },
    [],
  );

  // A new range means a new track: drop any in-flight drag so its frozen
  // value and its pending throttled update never leak onto the new track.
  const rangeKey = `${minMpm}:${maxMpm}`;
  const [lastRangeKey, setLastRangeKey] = useState(rangeKey);
  if (lastRangeKey !== rangeKey) {
    setLastRangeKey(rangeKey);
    setDragValue(null);
  }
  useEffect(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, [rangeKey]);

  const applyThrottled = (value: number) => {
    const now = Date.now();
    const wait = BPM_DRAG_THROTTLE_MS - (now - lastApplyRef.current);
    if (pendingRef.current) clearTimeout(pendingRef.current);
    if (wait <= 0) {
      lastApplyRef.current = now;
      changeBpm(value).catch(() => {});
      return;
    }
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      lastApplyRef.current = Date.now();
      changeBpm(value).catch(() => {});
    }, wait);
  };

  const commit = (value: number) => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
    setDragValue(null);
    if (locked) return;
    changeBpm(value).catch(() => {});
  };

  const shownBpm = dragValue ?? bpm;
  const shownDiff = dragValue === null ? bpmDiff : bpmDiff + (dragValue - bpm);

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
            {shownBpm.toFixed(1)}
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
                  shownDiff > 0
                    ? theme.colors.success
                    : shownDiff < 0
                      ? theme.colors.error
                      : currentTheme.textSecondary,
              },
            ]}
          >
            {shownDiff > 0 ? "+" : ""}
            {shownDiff.toFixed(1)}
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

      {/* Keyed on the range: the native slider applies `value` before new
          min/max bounds (clamping it to the old ones) and ignores a `value`
          that did not change, so its thumb went stale when switching to a
          track with another range and back. Remounting resyncs it. */}
      <Slider
        key={rangeKey}
        style={styles.speedSliderSmall}
        testID="audio-player-bpm-slider"
        value={dragValue === null ? bpm : frozenValueRef.current}
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
          if (dragValue === null) frozenValueRef.current = bpm;
          setDragValue(value);
          applyThrottled(value);
        }}
        onSlidingComplete={commit}
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
