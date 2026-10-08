import { Minus, Plus, Trash2 } from "lucide-react-native";
import React from "react";
import { StyleSheet, Switch, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { useTheme } from "../../../context/ThemeContext";
import {
  DANCES,
  MAX_ROUND_HEATS,
  MIN_ROUND_HEATS,
  type Category,
  type RoundConfig,
  type RoundType,
} from "../../../stores/performance.store";
import { danceLabel } from "../utils/competitionProgram";

interface RoundCardProps {
  round: RoundConfig;
  /** 0-based position in the programme (testIDs use it). */
  index: number;
  canDelete: boolean;
  onCategoryChange: (category: Category) => void;
  onTypeChange: (type: RoundType) => void;
  onHeatsStep: (delta: number) => void;
  onToggleDance: (dance: string) => void;
  onDelete: () => void;
  /** Absent on the first round (nothing to alternate with). */
  onMixChange?: (mix: boolean) => void;
}

const slug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();

/** One « tour » of the competition programme. */
export const RoundCard: React.FC<RoundCardProps> = ({
  round,
  index,
  canDelete,
  onCategoryChange,
  onTypeChange,
  onHeatsStep,
  onToggleDance,
  onDelete,
  onMixChange,
}) => {
  const { theme } = useTheme();
  const prefix = `performance-round-${index}`;
  const isRound = round.type === "Round";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      testID={`${prefix}-card`}
    >
      <View style={styles.cardHeader}>
        <AppText variant="body" weight="bold" color={theme.text}>
          Tour {index + 1}
        </AppText>
        {canDelete && (
          <TouchableOpacity
            onPress={onDelete}
            style={styles.iconButton}
            testID={`${prefix}-delete-button`}
            accessibilityRole="button"
            accessibilityLabel={`Supprimer le tour ${index + 1}`}
            accessibilityHint="Retire ce tour du programme"
          >
            <Trash2 color={theme.textSecondary} size={18} />
          </TouchableOpacity>
        )}
      </View>

      {onMixChange && (
        <View style={[styles.row, styles.mixRow]}>
          <View style={styles.mixText}>
            <AppText variant="caption" weight="600" color={theme.text}>
              Passages mixés avec le tour {index}
            </AppText>
            <AppText variant="caption" color={theme.textSecondary}>
              Les passages alternent entre les deux tours, danse par danse (ex.
              Valse, Samba, Valse… puis Tango, Cha-cha-cha…).
            </AppText>
          </View>
          <Switch
            value={Boolean(round.mixWithPrevious)}
            onValueChange={onMixChange}
            trackColor={{ true: theme.primary }}
            testID={`${prefix}-mix-switch`}
            accessibilityLabel={`Passages mixés avec le tour ${index}`}
            accessibilityHint="Alterne les passages de ce tour avec ceux du tour précédent"
          />
        </View>
      )}

      <View style={styles.row}>
        <FluidSegmentedTab
          testID={`${prefix}-category-tab`}
          activeValue={round.category}
          onChange={(val) => onCategoryChange(val as Category)}
          options={[
            { label: "Latines", value: "Latin" },
            { label: "Standard", value: "Standard" },
          ]}
        />
      </View>

      <View style={styles.row}>
        <FluidSegmentedTab
          testID={`${prefix}-type-tab`}
          activeValue={round.type}
          onChange={(val) => onTypeChange(val as RoundType)}
          options={[
            { label: "Passage", value: "Round" },
            { label: "Finale", value: "Final" },
          ]}
        />
      </View>

      {isRound && (
        <View style={[styles.row, styles.heatsRow]}>
          <AppText variant="caption" color={theme.textSecondary}>
            Passages par danse
          </AppText>
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => onHeatsStep(-1)}
              disabled={round.heats <= MIN_ROUND_HEATS}
              style={[
                styles.stepButton,
                { borderColor: theme.border },
                round.heats <= MIN_ROUND_HEATS && styles.disabled,
              ]}
              testID={`${prefix}-heats-minus`}
              accessibilityRole="button"
              accessibilityLabel="Retirer un passage"
              accessibilityHint={`Minimum ${MIN_ROUND_HEATS} passages`}
              accessibilityState={{ disabled: round.heats <= MIN_ROUND_HEATS }}
            >
              <Minus color={theme.text} size={16} />
            </TouchableOpacity>
            <AppText
              variant="body"
              weight="bold"
              color={theme.text}
              style={styles.stepValue}
              testID={`${prefix}-heats-value`}
            >
              {round.heats}
            </AppText>
            <TouchableOpacity
              onPress={() => onHeatsStep(1)}
              disabled={round.heats >= MAX_ROUND_HEATS}
              style={[
                styles.stepButton,
                { borderColor: theme.border },
                round.heats >= MAX_ROUND_HEATS && styles.disabled,
              ]}
              testID={`${prefix}-heats-plus`}
              accessibilityRole="button"
              accessibilityLabel="Ajouter un passage"
              accessibilityHint="Augmente le nombre de passages par danse"
              accessibilityState={{ disabled: round.heats >= MAX_ROUND_HEATS }}
            >
              <Plus color={theme.text} size={16} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.dancesGrid}>
        {DANCES[round.category].map((dance) => {
          const isActive = round.selectedDances.includes(dance);
          return (
            <TouchableOpacity
              key={dance}
              testID={`${prefix}-dance-${slug(dance)}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isActive }}
              accessibilityLabel={`Danse ${danceLabel(dance)}`}
              accessibilityHint="Active ou désactive cette danse pour ce tour"
              onPress={() => onToggleDance(dance)}
              style={[
                styles.danceChip,
                isActive
                  ? {
                      borderColor: theme.primary,
                      backgroundColor: theme.primary,
                    }
                  : { borderColor: theme.border },
              ]}
            >
              <AppText
                variant="caption"
                weight="600"
                color={isActive ? "#FFF" : theme.text}
              >
                {danceLabel(dance)}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  iconButton: {
    padding: 6,
  },
  row: {
    marginBottom: 10,
  },
  mixRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mixText: {
    flex: 1,
  },
  heatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    minWidth: 36,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  dancesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  danceChip: {
    borderRadius: 30,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});
