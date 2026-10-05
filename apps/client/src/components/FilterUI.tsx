import React from "react";
import {
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
// import { TouchableOpacity } from 'react-native-gesture-handler'; // Removed to avoid potential context issues
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { AppText } from "./AppText";
const GradientBackground = ({ borderRadius }: { borderRadius: number }) => (
  <LinearGradient
    colors={["#004481", "#0088CE"]}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[StyleSheet.absoluteFill, { borderRadius }]}
  />
);

// --------------------
// 1. FILTER CHIPS (Pills)
// Used for: Category, Status, Tags
// --------------------
interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const FilterChip: React.FC<FilterChipProps> = ({
  label,
  isActive,
  onPress,
  style,
}) => {
  const { theme, isDark } = useTheme();

  const chipDynamicStyle = {
    backgroundColor: isActive
      ? "transparent"
      : isDark
        ? "rgba(255,255,255,0.05)"
        : "#FFFFFF",
    borderColor: !isActive && !isDark ? "#EEEEEE" : "transparent",
    borderWidth: !isActive && !isDark ? 1 : 0,
  };

  const chipTextDynamicStyle = {
    color: isActive ? "#FFFFFF" : isDark ? theme.text : theme.textSecondary,
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.chip, chipDynamicStyle, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {isActive && <GradientBackground borderRadius={20} />}
      <AppText
        variant="caption"
        weight={isActive ? "600" : "normal"}
        style={[styles.chipText, chipTextDynamicStyle]}
      >
        {label}
      </AppText>
    </TouchableOpacity>
  );
};

// --------------------
// 2. SEGMENTED TABS
// --------------------
interface SegmentedTabProps {
  options: { label: string; value: string }[];
  activeValue: string;
  onChange: (value: string) => void;
}

export const SegmentedTab: React.FC<SegmentedTabProps> = ({
  options,
  activeValue,
  onChange,
}) => {
  const { theme, isDark } = useTheme();

  const segmentContainerDynamicStyle = {
    backgroundColor: theme.surface,
  };

  return (
    <View style={[styles.segmentContainer, segmentContainerDynamicStyle]}>
      {options.map((opt) => {
        const isActive = activeValue === opt.value;
        const segmentBtnDynamicStyle = isActive
          ? { backgroundColor: "transparent" }
          : undefined;
        const segmentTextDynamicStyle = {
          color: isActive ? "#FFFFFF" : isDark ? "#FFFFFF" : "#64748B",
        };

        return (
          <TouchableOpacity
            accessibilityRole="button"
            key={opt.value}
            style={[styles.segmentBtn, segmentBtnDynamicStyle]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.7}
          >
            {isActive && (
              <View style={styles.segmentActiveIndicator}>
                <GradientBackground borderRadius={8} />
              </View>
            )}
            <Text
              style={[
                styles.segmentText,
                isActive
                  ? styles.segmentTextActive
                  : styles.segmentTextInactive,
                segmentTextDynamicStyle,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  // Chip
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden", // Important for relative positioning context if needed
  },
  // Segment
  segmentContainer: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    overflow: "hidden",
  },
  chipText: {
    // Add any static text styles here if needed
  },
  segmentActiveIndicator: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    overflow: "hidden",
  },
  segmentText: {
    fontFamily: "DMSans-Medium",
    fontSize: 14,
    textAlign: "center",
    zIndex: 20,
    elevation: 20,
  },
  segmentTextActive: {
    fontWeight: "600",
  },
  segmentTextInactive: {
    fontWeight: "400",
  },
});
