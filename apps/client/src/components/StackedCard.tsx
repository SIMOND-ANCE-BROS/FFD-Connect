import React, { useEffect } from "react";
import {
  LayoutChangeEvent,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * How much of each card behind the front one shows above it (Apple
 * Wallet-like): enough for its coloured header — logo and title.
 */
export const STACKED_CARD_PEEK = 64;

export interface StackLayout {
  /** Vertical offset of each card, by list index. */
  offsets: number[];
  /**
   * Visible height of each card: undefined for the front card (or while the
   * heights are unknown); for a card behind it, what stays covered by the
   * front card, so a taller back card never shows under the front one.
   */
  clipHeights: Array<number | undefined>;
  /** Height the stack takes in the layout (cards are absolutely positioned). */
  height: number;
}

/**
 * Wallet geometry: the cards behind keep their list order, each one
 * `STACKED_CARD_PEEK` lower than the previous; the active card sits in front,
 * below all of them. Every card keeps its full size — only its offset changes —
 * so bringing a card forward animates its position, never its size.
 *
 * @param heights measured height of each card, by list index (undefined until
 * its first layout).
 */
export function getStackLayout(
  count: number,
  activeIndex: number,
  heights: Array<number | undefined>,
): StackLayout {
  let slot = 0;
  const offsets = Array.from({ length: count }, (_, index) =>
    index === activeIndex
      ? (count - 1) * STACKED_CARD_PEEK
      : STACKED_CARD_PEEK * slot++,
  );
  const activeHeight = heights[activeIndex];
  const frontBottom =
    activeHeight === undefined
      ? undefined
      : offsets[activeIndex] + activeHeight;
  const clipHeights = offsets.map((offset, index) =>
    index === activeIndex || frontBottom === undefined
      ? undefined
      : Math.max(STACKED_CARD_PEEK, frontBottom - offset),
  );
  const height = offsets.reduce((max, offset, index) => {
    const visible = clipHeights[index] ?? heights[index] ?? 0;
    return Math.max(max, offset + visible);
  }, 0);
  return { offsets, clipHeights, height };
}

interface StackedCardProps {
  index: number;
  isActive: boolean;
  /** Target vertical offset in the stack (see `getStackLayout`). */
  offset: number;
  /** Visible height when behind the front card (see `getStackLayout`). */
  clipHeight?: number;
  /** Reports the card's full height, needed to size the stack. */
  onHeightChange?: (index: number, height: number) => void;
  pullY: SharedValue<number>;
  pullGesture: ReturnType<typeof Gesture.Pan>;
  isPullable: boolean;
  onPress: () => void;
  /**
   * Screen reader label of a card behind the front one: the whole card is
   * then a single button that brings it forward.
   */
  backCardLabel?: string;
  children: React.ReactNode;
  testID?: string;
}

const MOVE_CONFIG = {
  duration: 350,
  easing: Easing.inOut(Easing.quad),
  // Jump straight to the new position when the OS "reduce motion" is on.
  reduceMotion: ReduceMotion.System,
};

export const StackedCard: React.FC<StackedCardProps> = ({
  index,
  isActive,
  offset,
  clipHeight,
  onHeightChange,
  pullY,
  pullGesture,
  isPullable,
  onPress,
  backCardLabel,
  children,
  testID,
}) => {
  // Starts at its slot: no animation on mount, only when the stack changes.
  const translateY = useSharedValue(offset);

  useEffect(() => {
    translateY.value = withTiming(offset, MOVE_CONFIG);
  }, [offset, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + (isPullable ? pullY.value : 0) },
    ],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(index, event.nativeEvent.layout.height);
  };

  const content = (
    <Animated.View
      testID={testID}
      onLayout={handleLayout}
      style={[styles.card, { zIndex: isActive ? 100 : index }, animatedStyle]}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        // Front card: not one big button, its own controls stay reachable.
        // Card behind: a single labelled button that brings it forward.
        accessible={!isActive}
        accessibilityRole="button"
        accessibilityLabel={isActive ? undefined : backCardLabel}
        accessibilityHint={
          isActive ? undefined : "Affiche cette carte au premier plan"
        }
      >
        <View
          // Behind the front card, only the header shows: a tap anywhere on
          // it brings the card forward, it never reaches the card's buttons.
          testID={testID ? `${testID}-content` : undefined}
          pointerEvents={isActive ? "auto" : "none"}
          importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}
          accessibilityElementsHidden={!isActive}
          style={
            clipHeight === undefined
              ? undefined
              : [styles.clip, { maxHeight: clipHeight }]
          }
        >
          {children}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  if (isPullable) {
    return <GestureDetector gesture={pullGesture}>{content}</GestureDetector>;
  }

  return content;
};

const styles = StyleSheet.create({
  // Every card is positioned in the stack (same width, offset only); the
  // container takes the stack height from `getStackLayout`.
  card: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  clip: {
    overflow: "hidden",
    borderRadius: 16,
  },
});
