import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { AppText } from "./AppText";
import { radii } from "../constants/radii";
import { useTheme } from "../context/ThemeContext";

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

/** Puce de filtre à bascule (sélectionnée = pleine, couleur primaire). */
export const FilterChip = ({
  label,
  selected,
  onPress,
  testID,
}: FilterChipProps) => {
  const { theme, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint="Active ou retire ce filtre"
      testID={testID}
      // The chip draws ~34pt tall (caption + 8pt padding): extend the touch
      // area to the 44pt minimum without changing the layout.
      hitSlop={CHIP_HIT_SLOP}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.primaryFill : theme.border,
          backgroundColor: selected
            ? theme.primaryFill
            : isDark
              ? "rgba(255,255,255,0.05)"
              : "#F5F5F5",
        },
      ]}
    >
      <AppText
        variant="caption"
        weight={selected ? "bold" : "500"}
        color={selected ? "#FFFFFF" : theme.text}
      >
        {label}
      </AppText>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
});
