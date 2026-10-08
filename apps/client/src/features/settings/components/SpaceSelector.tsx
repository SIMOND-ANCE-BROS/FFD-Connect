import { Check } from "lucide-react-native";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../../../context/ThemeContext";
import type { AuthRole } from "../../../stores/auth.store";
import { styles } from "./settings.styles";

type SpaceRole = Exclude<AuthRole, "GUEST">;

export const SPACE_LABELS: Record<SpaceRole, string> = {
  LICENSEE: "Danseur",
  CLUB: "Club",
  STAFF: "Staff",
  ADMIN: "Admin",
};

interface SpaceSelectorProps {
  roles: AuthRole[];
  space: AuthRole | null;
  onChange: (space: SpaceRole) => void;
}

/** Réglages → Espace. Hidden for a single-role account. */
export const SpaceSelector = ({
  roles,
  space,
  onChange,
}: SpaceSelectorProps) => {
  const { theme } = useTheme();
  const choices = roles.filter((r): r is SpaceRole => r !== "GUEST");
  if (choices.length < 2) return null;

  return (
    <>
      <View style={styles.sectionTitleContainer}>
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: theme.textSecondary }]}
        >
          Espace
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {choices.map((r, index) => {
          const selected = r === space;
          return (
            <TouchableOpacity
              key={r}
              accessibilityRole="button"
              accessibilityLabel={SPACE_LABELS[r]}
              accessibilityHint="Change l'espace actif de l'application"
              accessibilityState={{ selected }}
              testID={`settings-space-${r}`}
              onPress={() => onChange(r)}
              style={[
                styles.row,
                index > 0 && styles.borderTop,
                index > 0 && { borderTopColor: theme.border },
              ]}
            >
              <Text style={[styles.rowLabel, { color: theme.text }]}>
                {SPACE_LABELS[r]}
              </Text>
              {selected && <Check size={18} color={theme.primary} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
};
