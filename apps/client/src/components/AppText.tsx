import React, { useMemo } from "react";
import { StyleSheet, Text, TextProps } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { theme } from "../theme";

interface TypographyStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  marginBottom?: number;
  color?: string;
}

type TypographyVariant = keyof typeof theme.typography;

interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  weight?: "normal" | "bold" | "600" | "500";
  align?: "left" | "center" | "right";
}

const AppTextComponent: React.FC<AppTextProps> = ({
  children,
  style,
  variant = "body",
  color,
  weight,
  align,
  ...props
}) => {
  const { theme: currentTheme } = useTheme();

  // Get base style from variant
  const variantStyle = theme.typography[variant] as TypographyStyle;

  // Explicitly apply font family from theme to ensure override
  const fontFamily = variantStyle.fontFamily;

  // Determine color (prop overrides theme default)
  const textColor = useMemo(
    () =>
      color ??
      (variant === "caption" ? currentTheme.textSecondary : currentTheme.text),
    [color, variant, currentTheme.textSecondary, currentTheme.text],
  );

  const weightStyleMap: Record<NonNullable<AppTextProps["weight"]>, object> = {
    normal: styles.weight_normal,
    bold: styles.weight_bold,
    "600": styles.weight_600,
    "500": styles.weight_500,
  };

  const alignStyleMap: Record<NonNullable<AppTextProps["align"]>, object> = {
    left: styles.align_left,
    center: styles.align_center,
    right: styles.align_right,
  };

  const computedStyle = useMemo(
    () => [
      variantStyle,
      styles.baseText,
      { fontFamily, color: textColor },
      weight && weightStyleMap[weight],
      align && alignStyleMap[align],
      style,
    ],
    [variantStyle, fontFamily, textColor, weight, align, style],
  );

  return (
    <Text style={computedStyle} {...props}>
      {children}
    </Text>
  );
};

// Memoize component to prevent unnecessary re-renders when props haven't changed
export const AppText = React.memo(AppTextComponent, (prevProps, nextProps) => {
  // Custom comparison: only re-render if relevant props changed
  return (
    prevProps.children === nextProps.children &&
    prevProps.variant === nextProps.variant &&
    prevProps.color === nextProps.color &&
    prevProps.weight === nextProps.weight &&
    prevProps.align === nextProps.align &&
    prevProps.style === nextProps.style &&
    prevProps.testID === nextProps.testID &&
    prevProps.accessibilityLabel === nextProps.accessibilityLabel
  );
});

AppText.displayName = "AppText";

const styles = StyleSheet.create({
  baseText: {
    // Base text styles are handled by variantStyle
  },
  weight_600: {
    fontWeight: "600",
  },
  weight_500: {
    fontWeight: "500",
  },
  weight_normal: {
    fontWeight: "normal",
  },
  weight_bold: {
    fontWeight: "bold",
  },
  align_center: {
    textAlign: "center",
  },
  align_right: {
    textAlign: "right",
  },
  align_left: {
    textAlign: "left",
  },
});
