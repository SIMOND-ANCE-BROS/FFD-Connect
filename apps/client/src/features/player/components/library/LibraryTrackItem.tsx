import { ArrowDownCircle, Music } from "lucide-react-native";
import React from "react";
import { Alert, Animated, Image, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import { DEBUG_PLAYER } from "../../../../config";
import { useIsOnline } from "../../../../hooks/useIsOnline";
import { logger } from "../../../../utils/logger";
import { TrackData } from "../../context/PlayerContext";
import { libraryStyles as styles } from "./library.styles";

interface LibraryTrackItemProps {
  item: TrackData;
  currentTheme: AppTheme;
  isDark: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  bar1: Animated.Value;
  bar2: Animated.Value;
  bar3: Animated.Value;
  onPress: (item: TrackData) => void;
  onLongPress?: (item: TrackData) => void;
}

export const LibraryTrackItem = React.memo(
  ({
    item,
    currentTheme,
    isDark,
    isCurrent,
    isPlaying,
    bar1,
    bar2,
    bar3,
    onPress,
    onLongPress,
  }: LibraryTrackItemProps) => {
    const isOnline = useIsOnline();
    // Hors ligne, seules les copies locales (favoris téléchargés / imports)
    // sont jouables — les autres sont grisées (#416).
    const unavailableOffline = !isOnline && !item.isDownloaded;

    const handlePress = () => {
      if (unavailableOffline) {
        Alert.alert(
          "Non disponible hors ligne",
          "Ajoutez ce titre aux favoris ❤️ pour qu'il soit téléchargé et écoutable sans connexion.",
        );
        return;
      }
      onPress(item);
    };

    return (
      <TouchableOpacity
        accessibilityRole="button"
        testID={`library-track-${item.id}`}
        style={[
          styles.trackItem,
          { backgroundColor: currentTheme.surface },
          isCurrent && [
            styles.currentTrackHighlight,
            {
              backgroundColor: isDark ? "rgba(0, 136, 206, 0.1)" : "#F0F9FF",
              borderLeftColor: currentTheme.secondary,
            },
          ],
          unavailableOffline && styles.trackItemUnavailable,
        ]}
        onPress={handlePress}
        onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      >
        <View
          style={[
            styles.imageContainer,
            isDark ? styles.imageContainerDark : styles.imageContainerLight,
          ]}
        >
          {item.artwork ? (
            <Image
              source={{ uri: item.artwork }}
              style={styles.artwork}
              onError={
                DEBUG_PLAYER
                  ? (e) => {
                      logger.warn("[Library] Artwork load failed", {
                        uri: item.artwork?.slice(0, 60),
                        nativeEvent: e.nativeEvent,
                      });
                    }
                  : undefined
              }
            />
          ) : (
            <View style={styles.artworkPlaceholder}>
              {item.style ? (
                <AppText
                  variant="h2"
                  weight="bold"
                  color={currentTheme.textSecondary}
                >
                  {item.style.charAt(0)}
                </AppText>
              ) : (
                <Music size={24} color={currentTheme.textSecondary} />
              )}
            </View>
          )}
          {isCurrent && isPlaying && (
            <View style={styles.playingOverlay}>
              <View style={styles.playingIndicator}>
                <Animated.View
                  style={[
                    styles.playingBar,
                    { backgroundColor: currentTheme.secondary, height: bar1 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.playingBar,
                    { backgroundColor: currentTheme.secondary, height: bar2 },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.playingBar,
                    { backgroundColor: currentTheme.secondary, height: bar3 },
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        <View style={styles.trackInfo}>
          <AppText
            variant="body"
            weight="600"
            color={isCurrent ? currentTheme.secondary : currentTheme.text}
            numberOfLines={1}
            style={styles.trackTitle}
          >
            {item.titleMasked ? "🔒 " : ""}
            {item.title}
          </AppText>
          <AppText
            variant="caption"
            color={currentTheme.textSecondary}
            numberOfLines={1}
          >
            {item.artist}
          </AppText>
          {item.style && (
            <View
              style={[
                styles.styleBadge,
                isDark ? styles.styleBadgeDark : styles.styleBadgeLight,
              ]}
            >
              <AppText
                variant="caption"
                weight="600"
                color={currentTheme.textSecondary}
                style={styles.styleText}
              >
                {item.style}
              </AppText>
            </View>
          )}
        </View>

        <View style={styles.rightActions}>
          {item.isDownloaded ? (
            <ArrowDownCircle
              size={16}
              color={currentTheme.secondary}
              testID={`library-track-${item.id}-downloaded`}
            />
          ) : null}
          <View
            style={[
              styles.bpmBadge,
              isDark ? styles.bpmBadgeDark : styles.bpmBadgeLight,
            ]}
          >
            <AppText variant="body" weight="bold" color={currentTheme.text}>
              {item.baseBpm ? Math.round(item.baseBpm) : "-"}
            </AppText>
            <AppText
              variant="caption"
              color={currentTheme.textSecondary}
              style={styles.bpmLabel}
            >
              MPM
            </AppText>
          </View>
        </View>
      </TouchableOpacity>
    );
  },
);
