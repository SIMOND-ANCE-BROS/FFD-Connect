import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useTheme } from "../context/ThemeContext";

/**
 * Whether the OS "Reduce motion" setting is on (iOS: Réduire les animations,
 * Android: Supprimer les animations). Reanimated animations already honour it
 * (`ReduceMotion.System` is their default); this hook is for the RN `Animated`
 * code paths (tab bar indicator, tab slide) that do not.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {
        // Unknown → keep animations (the app's own toggle still applies).
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setReduced(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Whether decorative motion should play: the in-app "Animations" toggle AND
 * the OS reduce-motion setting must both allow it (RGAA 13.8 / WCAG 2.3.3).
 */
export function useMotionEnabled(): boolean {
  const { animationsEnabled } = useTheme();
  const reduced = useReducedMotion();
  return animationsEnabled && !reduced;
}
