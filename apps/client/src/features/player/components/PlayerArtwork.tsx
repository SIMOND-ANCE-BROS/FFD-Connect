import { Music } from "lucide-react-native";
import React from "react";
import { Image, View } from "react-native";
import { AppTheme } from "../../../context/ThemeContext";
import { audioPlayerStyles as styles } from "./audio-player.styles";

interface PlayerArtworkProps {
  currentTheme: AppTheme;
  isDark: boolean;
  artwork: string | undefined;
  isBpmVisible: boolean;
}

export const PlayerArtwork = ({
  currentTheme,
  isDark,
  artwork,
  isBpmVisible,
}: PlayerArtworkProps) => (
  <View
    style={[
      styles.albumArtContainer,
      isBpmVisible && styles.albumArtSmall,
      isDark ? styles.albumArtDark : styles.albumArtLight,
      { shadowColor: currentTheme.secondary },
    ]}
  >
    {artwork ? (
      <Image
        source={{ uri: artwork }}
        style={styles.artworkImage}
        resizeMode="cover"
      />
    ) : (
      <View style={styles.artworkPlaceholder}>
        <Music color={currentTheme.textSecondary} size={80} strokeWidth={1} />
      </View>
    )}
  </View>
);
