import { Lock } from "lucide-react-native";
import React, { useCallback } from "react";
import { View, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import type { LayoutItem } from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./layout-canvas.styles";

interface DraggableLayoutItemProps {
  item: LayoutItem;
  canvasWidth: number;
  canvasHeight: number;
  theme: AppTheme;
  isSelected: boolean;
  zoomScale: number;
  onPositionChange: (id: string, x: number, y: number) => void;
  onBlockPress: (item: LayoutItem) => void;
  onQuickEdit: (item: LayoutItem) => void;
}

export function DraggableLayoutItem({
  item,
  canvasWidth,
  canvasHeight,
  theme,
  isSelected,
  zoomScale,
  onPositionChange,
  onBlockPress,
  onQuickEdit,
}: DraggableLayoutItemProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const clampPosition = useCallback(
    (xPct: number, yPct: number) => {
      const maxX = Math.max(0, 100 - item.width);
      const maxY = Math.max(0, 100 - item.height);
      return {
        x: Math.max(0, Math.min(maxX, xPct)),
        y: Math.max(0, Math.min(maxY, yPct)),
      };
    },
    [item.width, item.height],
  );

  const commitPosition = useCallback(
    (newX: number, newY: number) => {
      const { x, y } = clampPosition(newX, newY);
      onPositionChange(item.id, x, y);
    },
    [item.id, clampPosition, onPositionChange],
  );

  const firePress = useCallback(() => onBlockPress(item), [onBlockPress, item]);
  const fireQuickEdit = useCallback(
    () => onQuickEdit(item),
    [onQuickEdit, item],
  );

  const pan = Gesture.Pan()
    .activeOffsetX(12)
    .activeOffsetY(12)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const moved =
        Math.abs(translateX.value) > 10 || Math.abs(translateY.value) > 10;
      if (moved && canvasWidth > 0 && canvasHeight > 0) {
        const leftPx = (item.x / 100) * canvasWidth;
        const topPx = (item.y / 100) * canvasHeight;
        const effectiveScale = zoomScale || 1; // 0 is falsy, so || is intentional here
        const newLeftPx = leftPx + translateX.value / effectiveScale;
        const newTopPx = topPx + translateY.value / effectiveScale;
        const newX = (newLeftPx / canvasWidth) * 100;
        const newY = (newTopPx / canvasHeight) * 100;
        runOnJS(commitPosition)(newX, newY);
      } else {
        runOnJS(firePress)();
      }
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (success) {
        runOnJS(fireQuickEdit)();
      }
    });

  const gestures = Gesture.Simultaneous(pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${item.rotationDeg ?? 0}deg`,
      },
    ],
  }));

  const bgColor =
    item.type === "TABLE"
      ? `${theme.primary}40`
      : item.type === "GRADIN"
        ? `${theme.secondary}40`
        : `${theme.accent}30`;
  const borderColor =
    item.type === "TABLE"
      ? theme.primary
      : item.type === "GRADIN"
        ? theme.secondary
        : theme.accent;

  const lockedSet = new Set(item.lockedSeats ?? []);
  const totalSeats =
    item.type === "GRADIN" && item.rows != null && item.cols != null
      ? item.rows * item.cols
      : item.capacity;

  const orientation = item.orientation ?? "horizontal";

  const renderPlaces = () => {
    if (item.type === "GRADIN" && item.rows != null && item.cols != null) {
      const rows = item.rows;
      const cols = item.cols;
      const vertical = orientation === "vertical";
      const displayRowCount = vertical ? cols : rows;
      const displayColCount = vertical ? rows : cols;
      return (
        <View style={styles.placesGridFlex}>
          {Array.from({ length: displayRowCount }).map((_r, row) => (
            <View key={row} style={styles.placesRowFlex}>
              {Array.from({ length: displayColCount }).map((_c, col) => {
                const idx = vertical ? col * cols + row : row * cols + col;
                const locked = lockedSet.has(idx);
                const seatStyle = {
                  backgroundColor: locked ? theme.textSecondary : theme.primary,
                  opacity: locked ? 0.6 : 0.9,
                  borderColor: locked ? theme.border : theme.primary,
                };
                return (
                  <View key={idx} style={[styles.seatFlex, seatStyle]}>
                    {locked && <Lock size={8} color={theme.surface} />}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      );
    }
    if (item.type === "TABLE" && item.capacity > 0) {
      const isVertical = orientation === "vertical";
      return (
        <View style={[styles.placesRow, isVertical && styles.placesColumn]}>
          {Array.from({ length: item.capacity }).map((_, idx) => {
            const locked = lockedSet.has(idx);
            const tableSeatStyle = {
              backgroundColor: locked ? theme.textSecondary : theme.primary,
              opacity: locked ? 0.6 : 0.9,
              borderColor: locked ? theme.border : theme.primary,
            };
            return (
              <View key={idx} style={[styles.seat, tableSeatStyle]}>
                {locked && <Lock size={8} color={theme.surface} />}
              </View>
            );
          })}
        </View>
      );
    }
    if (item.type === "OTHER" && item.capacity > 0) {
      return (
        <View style={styles.placesRow}>
          {Array.from({ length: Math.min(item.capacity, 12) }).map((_, idx) => {
            const locked = lockedSet.has(idx);
            const otherSeatStyle = {
              backgroundColor: locked ? theme.textSecondary : theme.accent,
              opacity: locked ? 0.6 : 0.9,
              borderColor: locked ? theme.border : theme.accent,
            };
            return (
              <View key={idx} style={[styles.seat, otherSeatStyle]}>
                {locked && <Lock size={8} color={theme.surface} />}
              </View>
            );
          })}
          {item.capacity > 12 && (
            <AppText
              variant="caption"
              style={[styles.canvasSubtext, { color: theme.textSecondary }]}
            >
              +{item.capacity - 12}
            </AppText>
          )}
        </View>
      );
    }
    return null;
  };

  const itemDynamicStyle: ViewStyle = {
    left: `${item.x}%`,
    top: `${item.y}%`,
    width: `${item.width}%`,
    height: `${item.height}%`,
    backgroundColor: bgColor,
    borderColor: isSelected ? theme.primary : borderColor,
    borderWidth: isSelected ? 2 : 1,
    shadowColor: isSelected ? theme.primary : "transparent",
    shadowOpacity: isSelected ? 0.25 : 0,
    shadowRadius: isSelected ? 6 : 0,
    elevation: isSelected ? 3 : 0,
  };
  const labelStyle = [styles.canvasText, { color: theme.text }];
  const lockCountStyle = [styles.lockCount, { color: theme.textSecondary }];

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View
        style={[styles.draggableItem, itemDynamicStyle, animatedStyle]}
      >
        <View style={styles.draggableItemHeader}>
          <View style={styles.draggableItemLabel}>
            <AppText
              variant="caption"
              weight="600"
              style={labelStyle}
              numberOfLines={1}
            >
              {item.label}
            </AppText>
            {lockedSet.size > 0 && (
              <View style={styles.lockedBadgeRow}>
                <Lock size={8} color={theme.textSecondary} />
                <AppText variant="caption" style={lockCountStyle}>
                  {lockedSet.size}
                </AppText>
              </View>
            )}
          </View>
        </View>
        <View style={styles.placesContainer}>
          {totalSeats > 0 ? (
            renderPlaces()
          ) : (
            <AppText
              variant="caption"
              style={[styles.canvasSubtext, { color: theme.textSecondary }]}
            >
              {item.type === "GRADIN" ? "Colonnes × Lignes" : "Places"}
            </AppText>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
