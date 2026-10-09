import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  RotateCcw,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import {
  NestableDraggableFlatList,
  ScaleDecorator as ScaleDecoratorBase,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import type { DanceOrder } from "../../../stores/danceOrder.store";
import type { Category } from "../../../stores/performance.store";
import {
  CATEGORY_LABELS,
  danceLabel,
  moveDance,
} from "../utils/competitionProgram";

// Same narrowing as CompetitionTimingTab: the library types the decorator
// without children.
const ScaleDecorator = ScaleDecoratorBase as React.FC<{
  activeScale?: number;
  children?: React.ReactNode;
}>;

interface DanceOrderEditorProps {
  /** Categories shown (those danced somewhere in the programme). */
  categories: Category[];
  danceOrder: DanceOrder;
  /** True when every category is in the official order (reset disabled). */
  isOfficial: boolean;
  onChange: (category: Category, order: string[]) => void;
  onReset: () => void;
}

const slug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();

/**
 * Order of the dances of each category, applied to every round of the
 * programme. Drag the grip to reorder; the arrows are the accessible
 * alternative (screen readers cannot drag).
 */
export const DanceOrderEditor: React.FC<DanceOrderEditorProps> = ({
  categories,
  danceOrder,
  isOfficial,
  onChange,
  onReset,
}) => {
  const { theme } = useTheme();

  const renderCategory = (category: Category) => {
    const order = danceOrder[category];
    const prefix = `performance-dance-order-${category.toLowerCase()}`;
    const move = (from: number, to: number) =>
      onChange(category, moveDance(order, from, to));

    const renderItem = ({
      item,
      drag,
      isActive,
      getIndex,
    }: RenderItemParams<string>) => {
      const position = getIndex() ?? order.indexOf(item);
      const label = danceLabel(item);
      return (
        <ScaleDecorator>
          <View
            testID={`${prefix}-${slug(item)}`}
            style={[
              styles.row,
              {
                backgroundColor: theme.surface,
                borderColor: isActive ? theme.primary : theme.border,
              },
            ]}
          >
            <TouchableOpacity
              onPressIn={drag}
              disabled={isActive}
              style={styles.iconButton}
              testID={`${prefix}-${slug(item)}-drag`}
              accessibilityRole="button"
              accessibilityLabel={`Déplacer ${label}`}
              accessibilityHint="Maintenez et faites glisser pour changer l'ordre"
            >
              <GripVertical size={18} color={theme.textSecondary} />
            </TouchableOpacity>
            <AppText
              variant="caption"
              weight="600"
              color={theme.textSecondary}
              style={styles.position}
            >
              {position + 1}.
            </AppText>
            <AppText
              variant="body"
              weight="600"
              color={theme.text}
              style={styles.label}
            >
              {label}
            </AppText>
            <TouchableOpacity
              onPress={() => move(position, position - 1)}
              disabled={position === 0}
              style={[styles.iconButton, position === 0 && styles.disabled]}
              testID={`${prefix}-${slug(item)}-up`}
              accessibilityRole="button"
              accessibilityState={{ disabled: position === 0 }}
              accessibilityLabel={`Monter ${label}`}
              accessibilityHint="Fait passer cette danse une place plus tôt"
            >
              <ChevronUp size={18} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => move(position, position + 1)}
              disabled={position === order.length - 1}
              style={[
                styles.iconButton,
                position === order.length - 1 && styles.disabled,
              ]}
              testID={`${prefix}-${slug(item)}-down`}
              accessibilityRole="button"
              accessibilityState={{ disabled: position === order.length - 1 }}
              accessibilityLabel={`Descendre ${label}`}
              accessibilityHint="Fait passer cette danse une place plus tard"
            >
              <ChevronDown size={18} color={theme.text} />
            </TouchableOpacity>
          </View>
        </ScaleDecorator>
      );
    };

    return (
      <View key={category} style={styles.block} testID={prefix}>
        <AppText
          variant="caption"
          weight="600"
          color={theme.textSecondary}
          style={styles.blockLabel}
        >
          {CATEGORY_LABELS[category]}
        </AppText>
        <NestableDraggableFlatList
          data={[...order]}
          keyExtractor={(d) => d}
          renderItem={renderItem}
          onDragEnd={({ data }) => onChange(category, data)}
        />
      </View>
    );
  };

  return (
    <View testID="performance-dance-order">
      <AppText
        variant="caption"
        color={theme.textSecondary}
        style={styles.hint}
      >
        Appliqué à tous les tours, finales comprises. Faites glisser ou utilisez
        les flèches.
      </AppText>
      {categories.map(renderCategory)}
      <TouchableOpacity
        onPress={onReset}
        disabled={isOfficial}
        style={[
          styles.resetButton,
          { borderColor: theme.border },
          isOfficial && styles.disabled,
        ]}
        testID="performance-dance-order-reset"
        accessibilityRole="button"
        accessibilityState={{ disabled: isOfficial }}
        accessibilityLabel="Réinitialiser l'ordre officiel"
        accessibilityHint="Remet les danses de chaque catégorie dans l'ordre officiel"
      >
        <RotateCcw size={16} color={theme.primary} />
        <AppText variant="caption" weight="600" color={theme.primary}>
          Réinitialiser l&apos;ordre officiel
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  hint: {
    marginBottom: 10,
  },
  block: {
    marginBottom: 12,
  },
  blockLabel: {
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  iconButton: {
    padding: 8,
  },
  disabled: {
    opacity: 0.35,
  },
  position: {
    minWidth: 22,
  },
  label: {
    flex: 1,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 30,
    paddingVertical: 10,
  },
});
