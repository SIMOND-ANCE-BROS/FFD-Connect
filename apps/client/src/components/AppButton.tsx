import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextStyle,
  useColorScheme,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { theme } from "../theme";
import { AppText } from "./AppText";

// Native Gradient Helper
import { LinearGradient } from "expo-linear-gradient";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const GradientBackground = React.memo<{ borderRadius: number }>(
  ({ borderRadius }) => (
    <LinearGradient
      colors={["#004481", "#0088CE"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFill, { borderRadius }]}
    />
  ),
);

const AppButtonComponent: React.FC<AppButtonProps> = ({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  style,
  textStyle,
  testID,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const scheme = useColorScheme();
  const currentTheme = theme[scheme === "dark" ? "dark" : "light"];
  const palette = theme.colors;

  // Animation State
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = useCallback(() => {
    if (!disabled && !loading) {
      scale.value = withSpring(0.96, { damping: 10, stiffness: 300 });
    }
  }, [disabled, loading, scale]);

  const handlePressOut = useCallback(() => {
    if (!disabled && !loading) {
      scale.value = withSpring(1, { damping: 10, stiffness: 300 });
    }
  }, [disabled, loading, scale]);

  // Memoize color calculations based on variant and state
  const { backgroundColor, textColor, borderColor, borderWidth, showGradient } =
    useMemo(() => {
      const isPrimary = variant === "primary";
      const showGrad = isPrimary && !disabled;
      let bgColor: string;
      let txtColor: string;
      let bdrColor: string = "transparent";
      let bdrWidth = 0;

      switch (variant) {
        case "primary":
          bgColor = disabled ? palette.slate200 : "transparent";
          txtColor = disabled ? currentTheme.textSecondary : palette.white;
          break;
        case "secondary":
          bgColor = disabled ? palette.slate200 : currentTheme.accent;
          txtColor = palette.white;
          break;
        case "outline":
          bgColor = "transparent";
          txtColor = disabled
            ? currentTheme.textSecondary
            : currentTheme.primary;
          bdrColor = disabled
            ? currentTheme.textSecondary
            : currentTheme.primary;
          bdrWidth = 1;
          break;
        case "ghost":
          bgColor = "transparent";
          txtColor = disabled
            ? currentTheme.textSecondary
            : currentTheme.primary;
          break;
        case "danger":
          bgColor = palette.error;
          txtColor = palette.white;
          break;
        default:
          bgColor = currentTheme.primary;
          txtColor = palette.white;
      }

      return {
        backgroundColor: bgColor,
        textColor: txtColor,
        borderColor: bdrColor,
        borderWidth: bdrWidth,
        showGradient: showGrad,
      };
    }, [variant, disabled, currentTheme, palette]);

  const buttonStyle = useMemo(
    () => [
      styles.button,
      { backgroundColor, borderColor, borderWidth },
      variant === "primary" && !disabled && styles.primaryShadow,
    ],
    [variant, backgroundColor, borderColor, borderWidth, disabled],
  );

  const textStyleWithColor = useMemo(
    () => [
      styles.text,
      { color: textColor },
      icon ? styles.textWithIcon : undefined,
      textStyle,
    ],
    [textColor, icon, textStyle],
  );

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        style={buttonStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        testID={testID ?? `button-${variant}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      >
        {showGradient && <GradientBackground borderRadius={30} />}

        {loading ? (
          <ActivityIndicator color={textColor} testID="button-loader" />
        ) : (
          <>
            {icon}
            <AppText variant="button" style={textStyleWithColor}>
              {title}
            </AppText>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
};

export const AppButton = React.memo(AppButtonComponent);

AppButton.displayName = "AppButton";

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14, // Taller touch target
    paddingHorizontal: 32,
    borderRadius: 30, // Pill shape
    minHeight: 56, // Premium height
  },
  text: {
    fontWeight: "500", // Medium
    letterSpacing: 0.5,
  },
  textWithIcon: {
    marginLeft: 8,
  },
  // Shadow helper for Primary button
  primaryShadow: {
    shadowColor: theme.colors.ffdBlue,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
