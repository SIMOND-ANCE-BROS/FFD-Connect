import { useNavigation } from "@react-navigation/native";
import { Pause, Play } from "lucide-react-native";
import { useRef } from "react";
import {
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { joinA11yLabel } from "../../../utils/a11y";
import { useProgress } from "../../../utils/TrackPlayerWrapper";
import { usePlayer } from "../context/PlayerContext";

const SWIPE_THRESHOLD = 50;
const TAB_BAR_HEIGHT = 70;
const TAB_BAR_MIN_PADDING = 20;
const MINI_PLAYER_BOTTOM_GAP = 12;

export const MiniPlayer = ({
  currentRouteName,
}: {
  currentRouteName?: string;
}) => {
  const { theme: currentTheme, isDark } = useTheme();
  const { currentTrack, isPlaying, togglePlayback, resetPlayer } = usePlayer();
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const progress = useProgress();
  const insets = useSafeAreaInsets();

  // Helper to format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Animation values
  const pan = useRef(new Animated.ValueXY()).current;

  // Pan Responder (Keeping logic same...)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: new Animated.Value(0) }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > SWIPE_THRESHOLD) {
          Animated.timing(pan, {
            toValue: { x: gestureState.dx > 0 ? 500 : -500, y: 0 },
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            resetPlayer().catch(() => {});
            pan.setValue({ x: 0, y: 0 });
          });
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  // Visibility logic
  if (!currentTrack) return null;
  if (currentRouteName === "Login") return null;

  const bottomOffset =
    (insets.bottom || TAB_BAR_MIN_PADDING) +
    TAB_BAR_HEIGHT +
    MINI_PLAYER_BOTTOM_GAP;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: bottomOffset,
          backgroundColor: isDark
            ? currentTheme.surface
            : currentTheme.background,
          borderColor: currentTheme.border,
          transform: [{ translateX: pan.x }],
          opacity: pan.x.interpolate({
            inputRange: [-200, 0, 200],
            outputRange: [0.5, 1, 0.5],
          }),
          shadowColor: currentTheme.text, // Subtle shadow using text color
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* The play button is a SIBLING of this touchable, not a child: a
          touchable merges its subtree into one VoiceOver element, which made
          the nested play button unreachable. Swipe-to-close has no screen
          reader equivalent, hence the custom "Fermer le lecteur" action. */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={joinA11yLabel([
          "Lecteur",
          currentTrack.title,
          currentTrack.style,
          currentTrack.artist,
        ])}
        accessibilityHint="Ouvre le lecteur en plein écran"
        accessibilityActions={[
          { name: "activate" },
          { name: "dismiss", label: "Fermer le lecteur" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "dismiss") {
            resetPlayer().catch(() => {});
          } else {
            navigation.navigate("AudioPlayer");
          }
        }}
        activeOpacity={0.9}
        onPress={() => navigation.navigate("AudioPlayer")}
        style={styles.innerContainer}
        testID="mini-player-container"
      >
        <View
          style={[
            styles.imageContainer,
            isDark ? styles.bgDarkImage : styles.bgLightImage,
          ]}
        >
          {currentTrack.artwork ? (
            <Image
              source={{ uri: currentTrack.artwork }}
              style={styles.artworkImage}
              resizeMode="cover"
              testID="mini-player-artwork"
            />
          ) : (
            <View style={styles.placeholderIcon}>
              <AppText variant="h3">🎵</AppText>
            </View>
          )}
        </View>

        <View style={styles.textContainer}>
          <AppText
            variant="body"
            weight="600"
            style={{ color: currentTheme.text }}
            numberOfLines={1}
          >
            {currentTrack.title}
          </AppText>
          <AppText
            variant="caption"
            style={{ color: currentTheme.textSecondary }}
            numberOfLines={1}
          >
            {currentTrack.style ? `${currentTrack.style} • ` : ""}
            {currentTrack.artist}
          </AppText>
        </View>

        <View style={styles.controlsContainer}>
          <AppText
            variant="caption"
            style={[styles.timeText, { color: currentTheme.textSecondary }]}
          >
            {formatTime(progress.position)} / {formatTime(progress.duration)}
          </AppText>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause" : "Lecture"}
        accessibilityHint="Met en pause ou reprend la musique"
        onPress={() => {
          togglePlayback().catch(() => {});
        }}
        style={styles.playButton}
        testID="mini-player-play-button"
      >
        {isPlaying ? (
          <Pause
            color={currentTheme.primary}
            size={24}
            fill={currentTheme.primary}
            testID="mini-player-pause-icon"
          />
        ) : (
          <Play color={currentTheme.text} size={24} fill={currentTheme.text} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 10,
    right: 10,
    height: 60,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, // Reduced for lighter feel
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
  },
  innerContainer: {
    flex: 1,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
  },
  imageContainer: {
    width: 40,
    height: 40,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    overflow: "hidden",
  },
  artworkImage: {
    width: "100%",
    height: "100%",
  },
  textContainer: {
    flex: 1,
    justifyContent: "center",
  },
  bgDarkImage: {
    backgroundColor: "#333",
  },
  bgLightImage: {
    backgroundColor: "#EEE",
  },
  placeholderIcon: {
    opacity: 0.5,
  },
  controlsContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    marginRight: 8,
    fontVariant: ["tabular-nums"],
  },
  playButton: {
    padding: 10,
    // Takes over the right inset the inner row used to provide.
    marginRight: 10,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
