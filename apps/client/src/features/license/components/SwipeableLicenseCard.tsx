import { Trash2 } from "lucide-react-native";
import React, { useCallback } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppTheme } from "../../../context/ThemeContext";

interface SwipeableLicenseCardProps {
  children: React.ReactNode;
  onRemove: (reset: () => void) => void;
  enabled?: boolean;
  theme: AppTheme;
}

export const SwipeableLicenseCard: React.FC<SwipeableLicenseCardProps> = ({
  children,
  onRemove,
  enabled = true,
  theme,
}) => {
  const translateX = useSharedValue(0);
  const screenWidth = Dimensions.get("window").width;

  const runRemove = useCallback(() => {
    onRemove(() => {
      translateX.value = withTiming(0, {
        duration: 350,
        easing: Easing.inOut(Easing.quad),
      });
    });
  }, [onRemove, translateX]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) > screenWidth * 0.35) {
        const direction = event.translationX > 0 ? 1 : -1;
        translateX.value = withTiming(
          direction * screenWidth,
          { duration: 200 },
          (finished) => {
            if (finished) {
              runOnJS(runRemove)();
            }
          },
        );
      } else {
        translateX.value = withTiming(0, {
          duration: 350,
          easing: Easing.inOut(Easing.quad),
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const leftIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, 50], [0, 1]),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [0, 100],
          [0.5, 1.2],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <View>
      <View
        style={[
          styles.deleteAction,
          theme.dark ? styles.deleteActionDark : styles.deleteActionLight,
        ]}
      >
        <Animated.View style={leftIconStyle}>
          <Trash2 size={32} color={theme.colors.error || "#EF4444"} />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.cardWrapper,
            { backgroundColor: theme.surface },
            animatedStyle,
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  deleteAction: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 30,
    borderRadius: 16,
  },
  cardWrapper: {
    borderRadius: 16,
    zIndex: 2,
  },
  deleteActionLight: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
  },
  deleteActionDark: {
    backgroundColor: "rgba(15, 23, 42, 0.95)",
  },
});
