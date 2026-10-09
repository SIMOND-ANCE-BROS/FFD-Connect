import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../../../context/ThemeContext";
import type { TrackCorrectionStatus } from "../../../services/api/track-correction-api";
import { DANCE_GROUPS } from "../../player/utils/danceTempo";
import { STATUS_LABELS } from "../utils/trackCorrections";
import { formatDiscipline } from "../../../utils/discipline";

interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  accessibilityHint: string;
}

/** Puce sélectionnable (motif, danse, filtre de statut). */
export const ChoiceChip = ({
  label,
  selected,
  onPress,
  testID,
  accessibilityHint,
}: ChoiceChipProps) => {
  const { theme, isDark } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPress={onPress}
      style={[
        styles.chip,
        isDark ? styles.bgDarkChip : styles.bgLightChip,
        { borderColor: theme.border },
        selected && {
          backgroundColor: theme.primary,
          borderColor: theme.primary,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: theme.textSecondary },
          selected && (isDark ? styles.textDarkActive : styles.textLightActive),
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

interface DanceChipsProps {
  value: string | null;
  onChange: (dance: string) => void;
  /** Préfixe des testID (`<prefix>-<danse>`). */
  testIDPrefix: string;
}

/** Choix de la danse : mêmes groupes et libellés que l'éditeur admin. */
export const DanceChips = ({
  value,
  onChange,
  testIDPrefix,
}: DanceChipsProps) => {
  const { theme } = useTheme();
  return (
    <>
      {DANCE_GROUPS.map((group) => (
        <View key={group.label}>
          <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
            {formatDiscipline(group.label)}
          </Text>
          <View style={styles.grid}>
            {group.dances.map((dance) => (
              <ChoiceChip
                key={dance}
                label={dance}
                selected={value === dance}
                onPress={() => onChange(dance)}
                testID={`${testIDPrefix}-${dance}`}
                accessibilityHint="Choisit cette danse pour la musique"
              />
            ))}
          </View>
        </View>
      ))}
    </>
  );
};

/** Pastille de statut d'une proposition. */
export const StatusBadge = ({ status }: { status: TrackCorrectionStatus }) => {
  const { theme } = useTheme();
  const color =
    status === "APPROVED"
      ? theme.success
      : status === "REJECTED"
        ? theme.danger
        : theme.warning;
  return (
    <View
      style={[styles.badge, { backgroundColor: `${color}22` }]}
      testID={`correction-status-${status}`}
    >
      <Text style={[styles.badgeText, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
};

export const chipStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 5,
  },
});

const styles = StyleSheet.create({
  grid: chipStyles.grid,
  groupLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 2,
    opacity: 0.8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 15,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
  },
  bgDarkChip: { backgroundColor: "#333" },
  bgLightChip: { backgroundColor: "#E0E0E0" },
  textDarkActive: { color: "#000", fontWeight: "bold" },
  textLightActive: { color: "#FFF", fontWeight: "bold" },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
