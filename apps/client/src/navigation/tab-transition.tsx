import {
  BottomTabBarProps,
  BottomTabScreenProps,
} from "@react-navigation/bottom-tabs";
import { CompositeScreenProps, useIsFocused } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import React, { createContext, useContext, useEffect, useRef } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList, TabParamList } from "./types";

// The Reanimated-based CurvedTabBar is replaced by a lightweight floating
// Liquid Glass tab bar (FloatingGlassTabBar below). It keeps a sliding
// selection indicator (the highlight behind the active tab) and vertically
// centered icons/labels, without the gesture/worklets machinery that broke
// under Reanimated 4.

// --- Tab transition context ---

export type TabTransitionValue = { direction: -1 | 0 | 1; tick: number };

export const TabTransitionContext = createContext<TabTransitionValue>({
  direction: 0,
  tick: 0,
});

export const useTabTransition = () => useContext(TabTransitionContext);

// --- Animated wrapper for tab screens ---

const TabScreenTransition = ({ children }: { children: React.ReactNode }) => {
  const { direction, tick } = useTabTransition();
  const isFocused = useIsFocused();
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  // Tick of the last slide we actually animated. Regaining focus (e.g. swiping
  // back from a stack screen) flips isFocused without changing tick — we must
  // NOT re-run the slide then, or the revealed tab visibly rebounds.
  const lastAnimatedTick = useRef(0);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    // Only a real tab switch bumps `tick`. If it hasn't changed since we last
    // animated (focus regained, re-render), just sit still at rest.
    if (tick === 0 || tick === lastAnimatedTick.current) {
      translateX.setValue(0);
      opacity.setValue(1);
      return;
    }
    lastAnimatedTick.current = tick;

    const offset = direction === 0 ? 0 : direction > 0 ? 8 : -8;
    translateX.setValue(offset);
    opacity.setValue(1);

    Animated.timing(translateX, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [direction, isFocused, opacity, tick, translateX]);

  return (
    <Animated.View
      style={[styles.tabContent, { transform: [{ translateX }], opacity }]}
    >
      {children}
    </Animated.View>
  );
};

// --- Floating Liquid Glass tab bar ---

const ITEM_WIDTH = 96;
const PILL_HEIGHT = 58;

const FloatingGlassTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
  const { theme, isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const count = state.routes.length;
  const pillWidth = Math.min(count * ITEM_WIDTH + 16, screenWidth - 32);
  const itemWidth = pillWidth / count;
  // Inset horizontal = inset vertical (6px, cf. styles.indicator top/bottom) →
  // gap uniforme autour de l'indicateur, concentrique avec le pill extérieur.
  const indicatorWidth = itemWidth - 12;
  const indicatorTarget =
    state.index * itemWidth + (itemWidth - indicatorWidth) / 2;

  const translateX = useRef(new Animated.Value(indicatorTarget)).current;
  const isDraggingRef = useRef(false);

  useEffect(() => {
    // Skip while a drag is in progress so the finger stays in control.
    if (isDraggingRef.current) return;
    Animated.spring(translateX, {
      toValue: indicatorTarget,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [indicatorTarget, translateX]);

  // Drag-to-switch: hold the pill and slide, snap to the nearest tab on release.
  // Uses a JS-thread pan (runOnJS) driving the RN Animated.Value — no reanimated
  // worklets, so it survives the SDK 55/57 (reanimated 3/4) split that broke the
  // old worklet-driven tab bar gesture.
  const layoutRef = useRef({
    itemWidth,
    indicatorWidth,
    count,
    index: state.index,
  });
  layoutRef.current = { itemWidth, indicatorWidth, count, index: state.index };
  const navRef = useRef({ navigation, routes: state.routes });
  navRef.current = { navigation, routes: state.routes };
  const dragBaseRef = useRef(0);
  const lastXRef = useRef(indicatorTarget);

  const targetForIndex = (i: number) => {
    const { itemWidth: iw, indicatorWidth: ind } = layoutRef.current;
    return i * iw + (iw - ind) / 2;
  };

  const settleTo = (i: number) => {
    const { navigation: nav, routes } = navRef.current;
    const route = routes[i] as (typeof routes)[number] | undefined;
    if (route) {
      const focused = layoutRef.current.index === i;
      const event = nav.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        nav.navigate(route.name);
      }
    }
    Animated.spring(translateX, {
      toValue: targetForIndex(i),
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  };

  const panGesture = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-10, 10])
      .onBegin(() => {
        // Capture the start position, but do NOT flag dragging yet: onBegin
        // fires on every touch-down, including a plain tap. Flagging here made
        // the route-change spring (guarded by isDragging) skip on tap, so the
        // indicator stayed on the previous tab. Only a real move (onUpdate)
        // counts as dragging.
        dragBaseRef.current = targetForIndex(layoutRef.current.index);
      })
      .onUpdate((e) => {
        isDraggingRef.current = true;
        const {
          itemWidth: iw,
          indicatorWidth: ind,
          count: n,
        } = layoutRef.current;
        const min = (iw - ind) / 2;
        const max = (n - 1) * iw + (iw - ind) / 2;
        const x = Math.max(
          min,
          Math.min(dragBaseRef.current + e.translationX, max),
        );
        lastXRef.current = x;
        translateX.setValue(x);
      })
      .onEnd(() => {
        isDraggingRef.current = false;
        const {
          itemWidth: iw,
          indicatorWidth: ind,
          count: n,
        } = layoutRef.current;
        const offset = (iw - ind) / 2;
        const idx = Math.max(
          0,
          Math.min(Math.round((lastXRef.current - offset) / iw), n - 1),
        );
        settleTo(idx);
      })
      .onFinalize(() => {
        isDraggingRef.current = false;
      }),
  ).current;

  return (
    <View style={styles.tabBarContainer} pointerEvents="box-none">
      <GestureDetector gesture={panGesture}>
        <View style={[styles.pill, { width: pillWidth }]}>
          {isLiquidGlassAvailable() ? (
            <GlassView
              glassEffectStyle="regular"
              style={styles.pillBackground}
            />
          ) : (
            <BlurView
              tint="systemChromeMaterial"
              intensity={80}
              style={styles.pillBackground}
            />
          )}

          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              { width: indicatorWidth, transform: [{ translateX }] },
            ]}
          >
            {isLiquidGlassAvailable() ? (
              // On iOS 26 the selection highlight is a real Liquid Glass capsule,
              // tinted with the brand color, that lifts above the bar's glass.
              <GlassView
                glassEffectStyle="regular"
                tintColor={`${theme.primary}40`}
                isInteractive
                style={styles.indicatorFill}
              />
            ) : (
              <View
                style={[
                  styles.indicatorFill,
                  {
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.15)"
                      : `${theme.primary}20`,
                  },
                ]}
              />
            )}
          </Animated.View>

          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const color = focused ? theme.primary : theme.textSecondary;

            const labelValue =
              options.tabBarLabel ?? options.title ?? route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({ type: "tabLongPress", target: route.key });
            };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                accessibilityHint="Naviguer vers cet onglet"
                testID={
                  (options as unknown as { tabBarTestID?: string }).tabBarTestID
                }
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tabButton}
              >
                {options.tabBarIcon?.({ focused, color, size: 24 })}
                {typeof labelValue === "string" && labelValue.length > 0 ? (
                  <Text
                    numberOfLines={1}
                    // adjustsFontSizeToFit does NOT shrink text under this RN /
                    // New Arch build, so we don't rely on it. A small fixed font
                    // (see tabLabel) fits the longest labels ("Bibliothèque",
                    // "Compétitions") inside the pill; maxWidth + ellipsis is a
                    // hard backstop so a label can never spill past the selector.
                    style={[
                      styles.tabLabel,
                      { color, maxWidth: indicatorWidth, textAlign: "center" },
                    ]}
                  >
                    {labelValue}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  tabContent: {
    flex: 1,
  },
  tabBarContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
  },
  pill: {
    height: PILL_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(120,120,128,0.24)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  pillBackground: {
    ...StyleSheet.absoluteFill,
    borderRadius: 29,
  },
  indicator: {
    position: "absolute",
    top: 6,
    bottom: 6,
    left: 0,
    // Concentrique : rayon extérieur (29) − inset (6) = 23.
    borderRadius: 23,
    overflow: "hidden",
  },
  indicatorFill: {
    flex: 1,
    borderRadius: 23,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 3,
  },
  tabLabel: {
    // 8px so the longest labels ("Bibliothèque", "Compétitions") fit the
    // selection pill without relying on adjustsFontSizeToFit (broken on New Arch).
    fontSize: 8,
    fontWeight: "500",
  },
});

// --- HOC to wrap screens with tab transition ---

export type TabScreenComponent = React.ComponentType<
  CompositeScreenProps<
    BottomTabScreenProps<TabParamList, keyof TabParamList>,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export const withTabTransition = <P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> => {
  const Wrapped = (props: P) => (
    <TabScreenTransition>
      <Component {...props} />
    </TabScreenTransition>
  );
  Wrapped.displayName = `WithTabTransition(${
    Component.displayName ?? Component.name
  })`;
  return Wrapped as React.ComponentType<P>;
};

// --- Tab bar that reports index changes ---

interface TabBarWithTransitionProps extends BottomTabBarProps {
  onIndexChange: (index: number) => void;
}

export const TabBarWithTransition = ({
  onIndexChange,
  ...props
}: TabBarWithTransitionProps) => {
  useEffect(() => {
    onIndexChange(props.state.index);
  }, [onIndexChange, props.state.index]);

  return <FloatingGlassTabBar {...props} />;
};
