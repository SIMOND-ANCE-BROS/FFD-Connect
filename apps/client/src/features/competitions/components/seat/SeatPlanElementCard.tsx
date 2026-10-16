import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import { joinA11yLabel } from "../../../../utils/a11y";
import {
  canBookFreeElement,
  formatPrice,
  gradinSeatIndex,
  isSelectable,
  rowName,
  seatAccessibilityLabel,
  seatStatus,
  type BookableElement,
  type SeatSelection,
  type SeatStatus,
} from "../../utils/seatPlan";

interface Props {
  element: BookableElement;
  selection: SeatSelection | null;
  theme: AppTheme;
  disabled?: boolean;
  onSelectSeat: (itemId: string, seatIndex: number) => void;
  onSelectFree: (itemId: string) => void;
}

export const SEAT_SIZE = 34;

/**
 * Seat numbers sit in a fixed 34pt square: past this multiplier of the
 * system text size the number overflows the seat. The full name (row, seat,
 * state) is still given to the screen reader.
 */
const SEAT_TEXT_MAX_SCALE = 1.4;

interface SeatColors {
  background: string;
  border: string;
  text: string;
}

/** Colours of a seat; status is also told by the label, never colour alone. */
export function seatColors(
  status: SeatStatus,
  selected: boolean,
  theme: AppTheme,
): SeatColors {
  if (selected) {
    return { background: theme.primary, border: theme.primary, text: "white" };
  }
  switch (status) {
    case "free":
      return {
        background: theme.surface,
        border: theme.primary,
        text: theme.text,
      };
    case "mineHeld":
    case "minePaid":
      return {
        background: theme.surface,
        border: theme.success,
        text: theme.successText,
      };
    default:
      return {
        background: theme.border,
        border: theme.border,
        text: theme.textSecondary,
      };
  }
}

const SeatButton = ({
  element,
  index,
  selected,
  theme,
  disabled,
  onPress,
}: {
  element: BookableElement;
  index: number;
  selected: boolean;
  theme: AppTheme;
  disabled: boolean;
  onPress: (itemId: string, seatIndex: number) => void;
}) => {
  const status = seatStatus(element, index);
  const selectable = isSelectable(status);
  const colors = seatColors(status, selected, theme);
  const number = element.cols !== null ? (index % element.cols) + 1 : index + 1;
  return (
    <Pressable
      testID={`seat-${element.id}-${index}`}
      accessibilityRole="button"
      accessibilityLabel={seatAccessibilityLabel(element, index, status)}
      accessibilityHint={
        selectable && !selected ? "Sélectionne cette place" : undefined
      }
      accessibilityState={{
        selected,
        disabled: !selectable || disabled,
      }}
      disabled={!selectable || disabled}
      onPress={() => onPress(element.id, index)}
      // 34pt seat + 5pt on each side = 44pt touch target (WCAG 2.5.5).
      hitSlop={5}
      style={[
        styles.seat,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
        !selectable && status !== "minePaid" && styles.unavailableSeat,
      ]}
    >
      <AppText
        variant="caption"
        weight={selected ? "bold" : "500"}
        color={colors.text}
        style={!selectable && status !== "minePaid" && styles.struck}
        maxFontSizeMultiplier={SEAT_TEXT_MAX_SCALE}
      >
        {number}
      </AppText>
    </Pressable>
  );
};

/** Seats of a numbered element: a rows × cols grid (gradin) or a wrap (table). */
const NumberedSeats = ({
  element,
  selection,
  theme,
  disabled,
  onSelectSeat,
}: Omit<Props, "onSelectFree"> & { disabled: boolean }) => {
  const isSelected = (index: number) =>
    selection?.itemId === element.id && selection.seatIndex === index;

  if (element.rows !== null && element.cols !== null) {
    const { rows, cols } = element;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {Array.from({ length: rows }, (_, row) => (
            <View key={row} style={styles.gridRow}>
              <AppText
                variant="caption"
                color={theme.textSecondary}
                style={styles.rowName}
                accessible={false}
                maxFontSizeMultiplier={SEAT_TEXT_MAX_SCALE}
              >
                {rowName(row)}
              </AppText>
              {Array.from({ length: cols }, (_, col) => {
                const index = gradinSeatIndex(row, col, cols);
                return (
                  <SeatButton
                    key={index}
                    element={element}
                    index={index}
                    selected={isSelected(index)}
                    theme={theme}
                    disabled={disabled}
                    onPress={onSelectSeat}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.wrap}>
      {Array.from({ length: element.seatCount }, (_, index) => (
        <SeatButton
          key={index}
          element={element}
          index={index}
          selected={isSelected(index)}
          theme={theme}
          disabled={disabled}
          onPress={onSelectSeat}
        />
      ))}
    </View>
  );
};

function availabilityText(element: BookableElement): string {
  const { available } = element.occupancy;
  if (element.occupancy.wholeElementBooked || available <= 0) return "Complet";
  return available === 1
    ? "1 place disponible"
    : `${available} places disponibles`;
}

/** One element of the seat plan: header, then its seats or free placement. */
export const SeatPlanElementCard = ({
  element,
  selection,
  theme,
  disabled = false,
  onSelectSeat,
  onSelectFree,
}: Props) => {
  const freeSelected =
    selection?.itemId === element.id && selection.seatIndex === undefined;
  const freeBookable = canBookFreeElement(element);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      testID={`seat-element-${element.id}`}
    >
      <View
        style={styles.header}
        accessible
        accessibilityRole="header"
        accessibilityLabel={joinA11yLabel([
          element.label,
          element.priceCents !== null && formatPrice(element.priceCents),
          availabilityText(element),
          element.mode === "free" && "placement libre",
        ])}
        accessibilityHint="Élément du plan de salle, ses places suivent"
        testID={`seat-element-header-${element.id}`}
      >
        <View style={styles.headerText}>
          <AppText variant="body" weight="600" color={theme.text}>
            {element.label}
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            {availabilityText(element)}
            {element.mode === "free" ? " · placement libre" : ""}
          </AppText>
        </View>
        {element.priceCents !== null && (
          <AppText variant="body" weight="600" color={theme.primary}>
            {formatPrice(element.priceCents)}
          </AppText>
        )}
      </View>

      {element.mode === "numbered" ? (
        <NumberedSeats
          element={element}
          selection={selection}
          theme={theme}
          disabled={disabled}
          onSelectSeat={onSelectSeat}
        />
      ) : (
        <Pressable
          testID={`seat-free-${element.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${element.label}, placement libre, ${availabilityText(element)}`}
          accessibilityHint={
            freeBookable && !freeSelected
              ? "Sélectionne une place en placement libre"
              : undefined
          }
          accessibilityState={{
            selected: freeSelected,
            disabled: !freeBookable || disabled,
          }}
          disabled={!freeBookable || disabled}
          onPress={() => onSelectFree(element.id)}
          style={[
            styles.freeButton,
            {
              borderColor: freeBookable ? theme.primary : theme.border,
              backgroundColor: freeSelected ? theme.primary : theme.surface,
            },
          ]}
        >
          <AppText
            variant="body"
            weight="600"
            color={
              freeSelected
                ? "white"
                : freeBookable
                  ? theme.primary
                  : theme.textSecondary
            }
          >
            {freeBookable
              ? freeSelected
                ? "Place sélectionnée"
                : "Choisir une place (placement libre)"
              : "Complet"}
          </AppText>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  rowName: {
    width: 22,
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  seat: {
    width: SEAT_SIZE,
    height: SEAT_SIZE,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
    marginBottom: 6,
  },
  unavailableSeat: {
    opacity: 0.55,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  freeButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
});
