import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useMotionEnabled } from "../hooks/useReducedMotion";
import { theme as appTheme } from "../theme";
import { AppText } from "./AppText";

interface FluidSegmentedTabProps {
  options: { label: string; value: string }[];
  activeValue: string;
  onChange: (value: string) => void;
  testID?: string;
}

/** Largest text scale of a segment label (fixed-height capsule, #22). */
export const SEGMENT_TEXT_MAX_SCALE = 1.3;

const GradientBackground = ({ borderRadius }: { borderRadius: number }) => (
  <LinearGradient
    colors={appTheme.gradients.primary}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[StyleSheet.absoluteFill, { borderRadius }]}
  />
);

export const FluidSegmentedTab: React.FC<FluidSegmentedTabProps> = ({
  options,
  activeValue,
  onChange,
  testID,
}) => {
  const { theme } = useTheme();
  // In-app toggle AND the OS "Reduce motion" setting (RGAA 13.8).
  const animationsEnabled = useMotionEnabled();
  const animationsEnabledRef = useRef(animationsEnabled);
  animationsEnabledRef.current = animationsEnabled;
  const [containerWidth, setContainerWidth] = useState(0);

  const tabWidth = useMemo(
    () => containerWidth / options.length,
    [containerWidth, options.length],
  );
  const activeIndex = useMemo(
    () => options.findIndex((o) => o.value === activeValue),
    [options, activeValue],
  );

  const translateX = useRef(new Animated.Value(0)).current;
  const isDraggingRef = useRef(false);

  useEffect(() => {
    // Skip while a drag is in progress so the finger stays in control.
    if (isDraggingRef.current) return;
    if (activeIndex === -1 || tabWidth <= 0) return;
    const target = activeIndex * tabWidth;
    if (animationsEnabled) {
      Animated.spring(translateX, {
        toValue: target,
        damping: 15,
        stiffness: 100,
        mass: 0.5,
        useNativeDriver: true,
      }).start();
    } else {
      translateX.setValue(target);
    }
  }, [activeIndex, tabWidth, animationsEnabled, translateX]);

  // Drag-to-switch: hold the indicator and slide, snap to the nearest segment on
  // release. Same SDK-agnostic pattern as the floating tab bar — a JS-thread pan
  // (runOnJS) driving the RN Animated.Value, no reanimated worklets. activeOffsetX
  // means the pan only engages after a real horizontal move, so a plain tap still
  // reaches the Pressables below. isDragging is flagged in onUpdate (not onBegin,
  // which fires on every touch-down) so a tap doesn't block the selection spring.
  const layoutRef = useRef({ tabWidth, count: options.length, activeIndex });
  layoutRef.current = { tabWidth, count: options.length, activeIndex };
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const dragBaseRef = useRef(0);
  const lastXRef = useRef(0);

  const panGesture = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-10, 10])
      .onBegin(() => {
        const { activeIndex: i, tabWidth: tw } = layoutRef.current;
        dragBaseRef.current = Math.max(i, 0) * tw;
      })
      .onUpdate((e) => {
        isDraggingRef.current = true;
        const { tabWidth: tw, count } = layoutRef.current;
        if (tw <= 0) return;
        const max = (count - 1) * tw;
        const x = Math.max(
          0,
          Math.min(dragBaseRef.current + e.translationX, max),
        );
        lastXRef.current = x;
        translateX.setValue(x);
      })
      .onEnd(() => {
        isDraggingRef.current = false;
        const { tabWidth: tw, count } = layoutRef.current;
        if (tw <= 0) return;
        const idx = Math.max(
          0,
          Math.min(Math.round(lastXRef.current / tw), count - 1),
        );
        const opt = optionsRef.current[idx] as
          | { label: string; value: string }
          | undefined;
        if (opt) changeRef.current(opt.value);
        // Snap the indicator to the resolved segment (needed when the drag stays
        // within the same segment, where onChange fires no state update).
        if (!animationsEnabledRef.current) {
          translateX.setValue(idx * tw);
          return;
        }
        Animated.spring(translateX, {
          toValue: idx * tw,
          damping: 15,
          stiffness: 100,
          mass: 0.5,
          useNativeDriver: true,
        }).start();
      })
      .onFinalize(() => {
        isDraggingRef.current = false;
      }),
  ).current;

  return (
    <View
      testID={testID}
      style={[styles.container, { backgroundColor: theme.surface }]}
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width - 8;
        setContainerWidth(w);
      }}
    >
      <GestureDetector gesture={panGesture}>
        {/* tablist + tab roles: screen readers announce "onglet, 1 sur 4"
            and which segment is selected. */}
        <View accessibilityRole="tablist" style={styles.gestureContainer}>
          {tabWidth > 0 && (
            <Animated.View
              collapsable={false}
              style={[
                styles.indicator,
                styles.indicatorColor,
                { width: tabWidth, transform: [{ translateX }] },
              ]}
            >
              <GradientBackground borderRadius={22} />
            </Animated.View>
          )}

          <View style={styles.contentContainer}>
            {options.map((opt) => {
              const isActive = activeValue === opt.value;
              const textColor = isActive
                ? "#FFFFFF"
                : theme.dark
                  ? "#FFFFFF"
                  : theme.textSecondary;

              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: isActive }}
                  accessibilityHint={
                    isActive ? "Filtre actif" : `Affiche : ${opt.label}`
                  }
                  key={opt.value}
                  // The segment is 40pt tall inside a 48pt capsule: extend the
                  // touch area to the capsule edges (>= 44pt).
                  hitSlop={{ top: 4, bottom: 4 }}
                  style={[styles.tabButton, { width: tabWidth }]}
                  onPress={() => onChange(opt.value)}
                  testID={testID ? `${testID}-${opt.value}` : undefined}
                >
                  <View style={[styles.labelWrapper, { width: tabWidth }]}>
                    <AppText
                      variant="body"
                      weight={isActive ? "600" : "normal"}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      // Fixed 40pt segment: grows with the system text size,
                      // capped so the label still fits (#22, large text).
                      maxFontSizeMultiplier={SEGMENT_TEXT_MAX_SCALE}
                      style={[styles.labelText, { color: textColor }]}
                    >
                      {opt.label}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    padding: 4,
    // Same radius as the floating tab-bar pill (RN clamps to height/2 => capsule).
    borderRadius: 29,
    height: 48,
  },
  indicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 22,
    overflow: "hidden",
  },
  contentContainer: {
    flexDirection: "row",
    position: "relative",
    height: "100%",
    alignItems: "center",
  },
  tabButton: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  gestureContainer: {
    flex: 1,
    height: "100%",
    width: "100%",
  },
  indicatorColor: {
    backgroundColor: appTheme.colors.ffdCyanDeep,
  },
  labelWrapper: {
    zIndex: 10,
    elevation: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  labelText: {
    textAlign: "center",
  },
});
