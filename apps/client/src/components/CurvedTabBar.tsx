import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { NavigationState, Route } from "@react-navigation/native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureStateChangeEvent,
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
} from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { logger } from "../utils/logger";

const { width } = Dimensions.get("window");
const TAB_BAR_WIDTH = width * 0.9;
const TAB_BAR_PADDING = 15;
const INDICATOR_SIZE = 48;

interface TabButtonProps {
  route: Route<string>;
  index: number;
  descriptors: BottomTabBarProps["descriptors"];
  state: NavigationState;
  currentTheme: { primary: string; textSecondary: string };
  isLightMode: boolean;
  tabWidth: number;
  onPressOverride: (index: number) => void;
}

const TabButton = React.memo(
  ({
    route,
    index,
    descriptors,
    state,
    currentTheme,
    isLightMode,
    tabWidth,
    onPressOverride,
  }: TabButtonProps) => {
    const { options } = descriptors[route.key];
    const isFocused = state.index === index;

    // Memoize icon color to avoid recalculation
    const iconColor = useMemo(
      () =>
        isFocused
          ? currentTheme.primary
          : isLightMode
            ? "#888888"
            : currentTheme.textSecondary,
      [
        isFocused,
        currentTheme.primary,
        currentTheme.textSecondary,
        isLightMode,
      ],
    );

    // Memoize press handler to prevent re-renders
    const handlePress = useCallback(() => {
      onPressOverride(index);
    }, [onPressOverride, index]);

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        accessibilityHint={
          options.tabBarAccessibilityLabel
            ? `Ouvrir l'onglet ${options.tabBarAccessibilityLabel}`
            : "Ouvrir l'onglet"
        }
        // accessibilityIdentifier removed as it might not be in AccessiblityProps for Web/some versions, testID is enough
        accessible
        testID={(options as { tabBarTestID?: string }).tabBarTestID}
        onPress={handlePress}
        style={[styles.tabButton, { width: tabWidth }]}
      >
        <View style={[styles.iconContainer]}>
          {options.tabBarIcon?.({
            focused: isFocused,
            color: iconColor,
            size: 24,
          })}
        </View>
      </Pressable>
    );
  },
);

export const CurvedTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
  const { theme: currentTheme, isDark, animationsEnabled } = useTheme();
  const insets = useSafeAreaInsets();
  const isLightMode = !isDark;

  const totalTabs = Math.max(1, state.routes.length);

  // Layout measurements
  const [containerWidth, setContainerWidth] = useState(
    TAB_BAR_WIDTH - TAB_BAR_PADDING * 2 - 2,
  );

  // Memoize calculated values to avoid recalculation on every render (guard against 0 to avoid singular matrix)
  const { tabWidth, indicatorOffset } = useMemo(() => {
    const aw = Math.max(0, containerWidth - TAB_BAR_PADDING * 2);
    const tw = totalTabs > 0 ? aw / totalTabs : 0;
    const io = tw > 0 ? (tw - INDICATOR_SIZE) / 2 : 0;
    return {
      availableWidth: aw,
      tabWidth: tw,
      indicatorOffset: io,
    };
  }, [containerWidth, totalTabs]);

  // Indicator position driven by RN's Animated (NOT reanimated shared values).
  // The pan gesture runs on the JS thread via .runOnJS(true), so there are no
  // worklets involved — this behaves identically on Reanimated 3 (SDK 55) and
  // Reanimated 4 (SDK 57), sidestepping the worklet/babel-plugin mismatch that
  // previously forced the spring snap to be disabled.
  const translateX = useRef(new Animated.Value(0)).current;
  const isDraggingRef = useRef(false);
  const dragXRef = useRef(0);

  // Live refs so the JS-thread pan callbacks never read stale closures.
  const tabWidthRef = useRef(tabWidth);
  const indicatorOffsetRef = useRef(indicatorOffset);
  const totalTabsRef = useRef(totalTabs);
  const animationsEnabledRef = useRef(animationsEnabled);

  useEffect(() => {
    tabWidthRef.current = tabWidth;
  }, [tabWidth]);
  useEffect(() => {
    indicatorOffsetRef.current = indicatorOffset;
  }, [indicatorOffset]);
  useEffect(() => {
    totalTabsRef.current = totalTabs;
  }, [totalTabs]);
  useEffect(() => {
    animationsEnabledRef.current = animationsEnabled;
  }, [animationsEnabled]);

  // Sync indicator to the focused tab when NOT dragging (skip invalid layout).
  // Spring snap restored now that RN Animated is used instead of reanimated.
  useEffect(() => {
    if (
      !isDraggingRef.current &&
      tabWidth > 0 &&
      Number.isFinite(indicatorOffset)
    ) {
      const target = state.index * tabWidth + indicatorOffset;
      dragXRef.current = target;
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
    }
  }, [state.index, tabWidth, indicatorOffset, translateX, animationsEnabled]);

  // Helper to trigger navigation from JS thread - memoized to prevent re-renders
  const navigateTo = useCallback(
    (index: number) => {
      const route = state.routes[index];
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (state.index !== index && !event.defaultPrevented) {
        logger.debug(`Navigation to ${route.name}`);
        navigation.navigate(route.name);
      }
    },
    [state.routes, state.index, navigation],
  );

  // Pan gesture on the JS thread (.runOnJS(true)) — plain JS callbacks driving
  // the RN Animated indicator directly. No reanimated worklets, so callbacks
  // may safely close over navigateTo and read live layout from refs.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(animationsEnabled) // Disable gesture if animations disabled
        .onBegin(() => {
          isDraggingRef.current = true;
          translateX.stopAnimation((value: number) => {
            dragXRef.current = value;
          });
        })
        .onUpdate(
          (event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
            const tw = tabWidthRef.current;
            const offset = indicatorOffsetRef.current;
            const total = totalTabsRef.current;
            if (tw <= 0) return;
            const nextX = dragXRef.current + event.translationX;
            // Clamp between first and last tab positions
            const minX = offset;
            const maxX = (total - 1) * tw + offset;
            const clamped = Math.max(minX, Math.min(nextX, maxX));
            translateX.setValue(clamped);
          },
        )
        .onEnd(
          (event: GestureStateChangeEvent<PanGestureHandlerEventPayload>) => {
            isDraggingRef.current = false;

            const tw = tabWidthRef.current;
            const offset = indicatorOffsetRef.current;
            const total = totalTabsRef.current;
            if (tw <= 0) return;

            // Predicted end position considering release velocity
            const currentX =
              dragXRef.current + event.translationX + event.velocityX * 0.2;

            // Find nearest slot, then clamp index
            const rawIndex = (currentX - offset) / tw;
            const finalIndex = Math.max(
              0,
              Math.min(Math.round(rawIndex), total - 1),
            );

            // Animate to snap position (spring restored — no worklet involved)
            const snapTarget = finalIndex * tw + offset;
            dragXRef.current = snapTarget;

            if (animationsEnabledRef.current) {
              Animated.spring(translateX, {
                toValue: snapTarget,
                damping: 15,
                stiffness: 100,
                mass: 0.5,
                useNativeDriver: true,
              }).start();
            } else {
              translateX.setValue(snapTarget);
            }

            // Trigger navigation directly — already on the JS thread.
            navigateTo(finalIndex);
          },
        ),
    [animationsEnabled, navigateTo, translateX],
  );

  const pillStyle = [
    styles.floatingPill,
    styles.pillDynamic,
    {
      backgroundColor: currentTheme.surface,
      shadowOpacity: isLightMode ? 0.1 : 0.3,
      borderColor: currentTheme.border,
    },
  ];

  const indicatorColorStyle = [
    styles.indicatorBase,
    {
      backgroundColor: isLightMode
        ? `${currentTheme.primary}20`
        : "rgba(255, 255, 255, 0.15)",
    },
  ];

  const hasValidLayout = tabWidth > 0 && Number.isFinite(indicatorOffset);

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom || 20 }]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={panGesture}>
        <View style={pillStyle} pointerEvents="auto">
          {/* Sliding Indicator Layer - only animate when layout is valid to avoid singular matrix */}
          <View
            style={styles.indicatorContainer}
            onLayout={(e: LayoutChangeEvent) => {
              // Measure precise width of the inner content area
              const w = e.nativeEvent.layout.width;
              if (w > 0 && Math.abs(w - containerWidth) > 1) {
                logger.debug(`[TabBar] Adjusted width: ${w}`);
                setContainerWidth(w);
              }
            }}
          >
            {hasValidLayout ? (
              <Animated.View
                style={[
                  styles.indicator,
                  indicatorColorStyle,
                  { transform: [{ translateX }] },
                ]}
              />
            ) : (
              <View style={[styles.indicator, indicatorColorStyle]} />
            )}
          </View>

          {/* Tab Buttons Layer */}
          <View style={styles.tabButtonsContainer}>
            {state.routes.map((route, index) => (
              <TabButton
                key={route.key}
                route={route}
                index={index}
                descriptors={descriptors}
                state={state}
                currentTheme={currentTheme}
                isLightMode={isLightMode}
                tabWidth={tabWidth}
                onPressOverride={navigateTo}
              />
            ))}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  floatingPill: {
    flexDirection: "row",
    width: TAB_BAR_WIDTH,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: TAB_BAR_PADDING,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 10,
  },
  indicatorContainer: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: TAB_BAR_PADDING,
    justifyContent: "center",
    // This view will be the reference for "available width"
  },
  tabButtonsContainer: {
    flexDirection: "row",
    flex: 1,
    height: "100%",
    // Ensure this overlays perfectly
  },
  tabButton: {
    // flex: 1, removed to use explicit width
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    zIndex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  indicator: {
    height: 48, // enforced height
    borderRadius: 16,
  },
  pillDynamic: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
  },
  indicatorBase: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
  },
});
