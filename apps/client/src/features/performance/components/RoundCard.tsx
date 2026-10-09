import { Plus, Trash2, X } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { useTheme } from "../../../context/ThemeContext";
import {
  OFFICIAL_DANCE_ORDER,
  type DanceOrder,
} from "../../../stores/danceOrder.store";
import {
  MAX_ROUND_GROUPS,
  MIN_ROUND_GROUPS,
  type Category,
  type RoundConfig,
  type RoundType,
} from "../../../stores/performance.store";
import {
  CATEGORY_LABELS,
  danceLabel,
  roundCategories,
  roundSequence,
} from "../utils/competitionProgram";

interface RoundCardProps {
  round: RoundConfig;
  /** 0-based position in the programme (testIDs use it). */
  index: number;
  canDelete: boolean;
  onTypeChange: (type: RoundType) => void;
  onAddGroup: () => void;
  onRemoveGroup: (groupIndex: number) => void;
  onGroupCategoryChange: (groupIndex: number, category: Category) => void;
  onToggleDance: (category: Category, dance: string) => void;
  onDelete: () => void;
  /** Per-category dance order (chips and floor-order preview follow it). */
  danceOrder?: DanceOrder;
}

const slug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();
const CATEGORIES: Category[] = ["Standard", "Latin"];
/** Steps shown in the floor-order preview before « … ». */
const PREVIEW_STEPS = 6;

/** One « tour » of the competition programme: its groups and dances. */
export const RoundCard: React.FC<RoundCardProps> = ({
  round,
  index,
  canDelete,
  onTypeChange,
  onAddGroup,
  onRemoveGroup,
  onGroupCategoryChange,
  onToggleDance,
  onDelete,
  danceOrder = OFFICIAL_DANCE_ORDER,
}) => {
  const { theme } = useTheme();
  const prefix = `performance-round-${index}`;
  const canRemoveGroup = round.groups.length > MIN_ROUND_GROUPS;
  const canAddGroup = round.groups.length < MAX_ROUND_GROUPS;
  const sequence = roundSequence(round, danceOrder);
  const preview = sequence
    .slice(0, PREVIEW_STEPS)
    .map((s) =>
      round.groups.length > 1
        ? `${danceLabel(s.dance)} (G${s.groupIndex})`
        : danceLabel(s.dance),
    )
    .join(" → ");

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

      <AppText
        variant="caption"
        weight="600"
        color={theme.textSecondary}
        style={styles.sectionLabel}
      >
        Groupes, dans l&apos;ordre de passage
      </AppText>
      {round.groups.map((category, g) => (
        <View
          // Groups have no identity of their own: position is the identity.
          key={g}
          style={styles.groupRow}
          testID={`${prefix}-group-${g}`}
        >
          <AppText
            variant="body"
            weight="600"
            color={theme.text}
            style={styles.groupLabel}
          >
            Groupe {g + 1}
          </AppText>
          <View style={styles.categoryChips}>
            {CATEGORIES.map((c) => {
              const active = c === category;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => onGroupCategoryChange(g, c)}
                  testID={`${prefix}-group-${g}-${c.toLowerCase()}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`Groupe ${g + 1} en ${CATEGORY_LABELS[c]}`}
                  accessibilityHint="Choisit la catégorie dansée par ce groupe"
                  style={[
                    styles.categoryChip,
                    active
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
                    color={active ? "#FFF" : theme.text}
                  >
                    {CATEGORY_LABELS[c]}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
          {canRemoveGroup ? (
            <TouchableOpacity
              onPress={() => onRemoveGroup(g)}
              style={styles.iconButton}
              testID={`${prefix}-group-${g}-remove`}
              accessibilityRole="button"
              accessibilityLabel={`Retirer le groupe ${g + 1}`}
              accessibilityHint="Retire ce groupe de l'ordre de passage"
            >
              <X color={theme.textSecondary} size={18} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconPlaceholder} />
          )}
        </View>
      ))}
      {canAddGroup && (
        <TouchableOpacity
          onPress={onAddGroup}
          style={[styles.addGroupButton, { borderColor: theme.border }]}
          testID={`${prefix}-add-group`}
          accessibilityRole="button"
          accessibilityLabel="Ajouter un groupe"
          accessibilityHint="Ajoute un groupe à la fin de l'ordre de passage"
        >
          <Plus color={theme.primary} size={16} />
          <AppText variant="caption" weight="600" color={theme.primary}>
            Ajouter un groupe
          </AppText>
        </TouchableOpacity>
      )}

      {roundCategories(round).map((category) => (
        <View key={category} style={styles.dancesBlock}>
          <AppText
            variant="caption"
            weight="600"
            color={theme.textSecondary}
            style={styles.sectionLabel}
          >
            Danses {CATEGORY_LABELS[category]}
          </AppText>
          <View style={styles.dancesGrid}>
            {danceOrder[category].map((dance) => {
              const isActive = round.dances[category].includes(dance);
              return (
                <TouchableOpacity
                  key={dance}
                  testID={`${prefix}-dance-${slug(dance)}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isActive }}
                  accessibilityLabel={`Danse ${danceLabel(dance)}`}
                  accessibilityHint="Active ou désactive cette danse pour ce tour"
                  onPress={() => onToggleDance(category, dance)}
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
      ))}

      {sequence.length > 0 && (
        <AppText
          variant="caption"
          color={theme.textSecondary}
          style={styles.preview}
          testID={`${prefix}-preview`}
        >
          Déroulé : {preview}
          {sequence.length > PREVIEW_STEPS ? " → …" : ""}
        </AppText>
      )}
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
  iconPlaceholder: {
    width: 30,
  },
  row: {
    marginBottom: 10,
  },
  sectionLabel: {
    marginBottom: 6,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  groupLabel: {
    minWidth: 80,
  },
  categoryChips: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  categoryChip: {
    flex: 1,
    alignItems: "center",
    borderRadius: 30,
    borderWidth: 1,
    paddingVertical: 6,
  },
  addGroupButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 30,
    paddingVertical: 8,
    marginTop: 2,
    marginBottom: 12,
  },
  dancesBlock: {
    marginBottom: 10,
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
  preview: {
    marginTop: 4,
  },
});
