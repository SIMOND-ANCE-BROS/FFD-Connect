import Slider from "@react-native-community/slider";
import React, { useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import { getEffectiveClashes, nextClash } from "../utils/pasoClashes";
import { audioPlayerStyles as styles, formatTime } from "./audio-player.styles";

interface PlayerProgressProps {
  currentTheme: AppTheme;
  isDark: boolean;
  progress: { position: number; duration: number };
  seekTo: (seconds: number) => Promise<void>;
  /** Paso doble : marqueurs des appels/coups sur la barre (#paso-clashes). */
  style?: string;
  clashTimecodes?: number[];
  /** Tempo de la piste (MPM) : cale l'estimation des clashs sur les phrases. */
  mpm?: number;
}

// The slider reserves a small horizontal inset for the thumb; align markers to
// the track by insetting the overlay the same amount.
const SLIDER_THUMB_INSET = 8;

export const PlayerProgress = ({
  currentTheme,
  isDark,
  progress,
  seekTo,
  style,
  clashTimecodes,
  mpm,
}: PlayerProgressProps) => {
  const [barWidth, setBarWidth] = useState(0);
  const clashes = getEffectiveClashes(
    style,
    clashTimecodes,
    progress.duration,
    mpm,
  );
  const upcoming =
    clashes.length > 0 ? nextClash(progress.position, clashes) : null;

  const onLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  const trackWidth = Math.max(0, barWidth - SLIDER_THUMB_INSET * 2);

  return (
    <View style={styles.progressContainer}>
      <View onLayout={onLayout}>
        <Slider
          style={styles.progressBar}
          value={progress.position}
          minimumValue={0}
          maximumValue={progress.duration || 1}
          thumbTintColor={currentTheme.primary}
          minimumTrackTintColor={currentTheme.primary}
          maximumTrackTintColor={isDark ? "rgba(255,255,255,0.1)" : "#E0E0E0"}
          onSlidingComplete={(value: number) => {
            seekTo(value).catch(() => {});
          }}
        />
        {/* Marqueurs des appels paso doble, superposés sur la barre. */}
        {progress.duration > 0 &&
          trackWidth > 0 &&
          clashes.map((t, i) => {
            const left =
              SLIDER_THUMB_INSET +
              (Math.min(t, progress.duration) / progress.duration) * trackWidth;
            const passed = progress.position >= t - 0.05;
            return (
              <View
                key={`${t}-${i}`}
                pointerEvents="none"
                style={[
                  markerStyles.marker,
                  {
                    left: left - 1,
                    backgroundColor: passed
                      ? currentTheme.textSecondary
                      : currentTheme.warning,
                  },
                ]}
                testID={`paso-clash-marker-${i}`}
              />
            );
          })}
      </View>

      <View style={styles.timeInfo}>
        <AppText
          variant="caption"
          color={currentTheme.textSecondary}
          style={styles.tabular}
        >
          {formatTime(progress.position)}
        </AppText>
        <AppText
          variant="caption"
          color={currentTheme.textSecondary}
          style={styles.tabular}
        >
          {formatTime(progress.duration)}
        </AppText>
      </View>

      {upcoming && (
        <AppText
          variant="caption"
          color={currentTheme.warning}
          align="center"
          style={markerStyles.nextClash}
          testID="paso-next-clash"
        >
          Prochain appel {upcoming.index}/{upcoming.total} dans{" "}
          {Math.max(0, Math.ceil(upcoming.time - progress.position))} s
        </AppText>
      )}
    </View>
  );
};

const markerStyles = StyleSheet.create({
  marker: {
    position: "absolute",
    top: "50%",
    marginTop: -7,
    width: 2,
    height: 14,
    borderRadius: 1,
  },
  nextClash: {
    marginTop: 4,
    fontWeight: "600",
  },
});
