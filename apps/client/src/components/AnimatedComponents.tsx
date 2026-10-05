import React from "react";
import { Pressable, StyleProp, ViewStyle } from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

// --- Types ---

interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  direction?: "up" | "down";
}

interface ScaleButtonProps {
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
}

// --- Components ---

/**
 * A wrapper that fades in its content with a slide effect.
 * Useful for screen entry animations.
 */
export const FadeInView: React.FC<FadeInViewProps> = React.memo(
  ({ children, delay = 0, duration = 500, style, direction = "up" }) => {
    const enteringAnimation = React.useMemo(
      () =>
        direction === "up"
          ? FadeInDown.delay(delay).duration(duration).springify()
          : FadeInUp.delay(delay).duration(duration).springify(),
      [direction, delay, duration],
    );

    return (
      <Animated.View entering={enteringAnimation} style={style}>
        {children}
      </Animated.View>
    );
  },
);

FadeInView.displayName = "FadeInView";

/**
 * A button wrapper that scales down slightly when pressed.
 * Provides tactile feedback (micro-interaction).
 */
export const ScaleButton: React.FC<ScaleButtonProps> = React.memo(
  ({ onPress, children, style, testID, disabled }) => {
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: scale.value }],
      };
    });

    const handlePressIn = React.useCallback(() => {
      scale.value = withSpring(0.96, { damping: 10, stiffness: 300 });
    }, [scale]);

    const handlePressOut = React.useCallback(() => {
      scale.value = withSpring(1, { damping: 10, stiffness: 300 });
    }, [scale]);

    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        testID={testID}
        style={style}
      >
        <Animated.View style={animatedStyle}>{children}</Animated.View>
      </Pressable>
    );
  },
);

ScaleButton.displayName = "ScaleButton";
