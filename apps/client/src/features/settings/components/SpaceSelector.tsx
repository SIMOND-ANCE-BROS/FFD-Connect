import { ChevronDown } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import type { AuthRole } from "../../../stores/auth.store";
import { SpaceSheet } from "./SpaceSheet";
import { SPACE_LABELS, type SpaceRole } from "./spaces";

export { SPACE_LABELS };

interface SpaceSelectorProps {
  roles: AuthRole[];
  space: AuthRole | null;
  onChange: (space: SpaceRole) => void;
}

/**
 * Header pill showing the active space; opens a bottom sheet to switch.
 * Hidden for an account holding fewer than two non-guest roles.
 */
export const SpaceSelector = ({
  roles,
  space,
  onChange,
}: SpaceSelectorProps) => {
  const { theme, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const choices = roles.filter((r): r is SpaceRole => r !== "GUEST");
  if (choices.length < 2) return null;

  const current = choices.find((r) => r === space) ?? null;
  const label = current ? SPACE_LABELS[current] : "Espace";

  const handleSelect = (next: SpaceRole) => {
    setOpen(false);
    if (next !== current) onChange(next);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Espace : ${label}`}
        accessibilityHint="Ouvre le sélecteur d'espace"
        testID="settings-space-pill"
        style={[
          styles.pill,
          {
            borderColor: theme.border,
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
          },
        ]}
      >
        <AppText
          variant="caption"
          color={theme.text}
          weight="600"
          style={styles.label}
        >
          {label}
        </AppText>
        <ChevronDown size={16} color={theme.text} />
      </TouchableOpacity>
      <SpaceSheet
        visible={open}
        choices={choices}
        current={current}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  pill: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
  },
  label: { marginBottom: 0 },
});
