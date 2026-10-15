import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Screen-reader focus helpers (VoiceOver / TalkBack, RGAA 7.1 / WCAG 2.4.3).
 *
 * When a modal closes or a screen swaps its content, the reader focus is
 * dropped on whatever element sits under the finger — often the top of the
 * screen. These helpers move it back to a meaningful element (the button
 * that opened the modal, the new step's heading…).
 *
 * RN 0.86: `sendAccessibilityEvent(hostInstance, "focus")` replaces the
 * deprecated `setAccessibilityFocus(findNodeHandle(ref))` and works with the
 * new architecture (Fabric) refs.
 */

/** A mounted host component (View, Text, Pressable…) that can take focus. */
export type A11yFocusTarget = Parameters<
  typeof AccessibilityInfo.sendAccessibilityEvent
>[0];

/**
 * Default delay before moving focus: lets the modal / navigation transition
 * finish, otherwise VoiceOver re-focuses the first element afterwards and
 * our request is lost.
 */
export const A11Y_FOCUS_DELAY_MS = 500;

/**
 * Moves the screen-reader focus to `target` after `delayMs`. Returns a
 * cancel function (call it on unmount). No-op when the target is not mounted.
 */
export function focusAccessibility(
  getTarget: () => A11yFocusTarget | null | undefined,
  delayMs: number = A11Y_FOCUS_DELAY_MS,
): () => void {
  const timer = setTimeout(() => {
    const target = getTarget();
    if (!target) return;
    try {
      AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    } catch {
      // The element was unmounted between the check and the call: nothing
      // to focus, the reader keeps its current position.
    }
  }, delayMs);
  return () => clearTimeout(timer);
}

/**
 * Returns the focus to `targetRef` when `visible` goes from true to false
 * (a modal / sheet closing). Typical use: the ref of the button that opened
 * the modal.
 */
export function useRestoreFocusOnClose(
  visible: boolean,
  targetRef: RefObject<A11yFocusTarget | null>,
  delayMs: number = A11Y_FOCUS_DELAY_MS,
): void {
  const wasVisible = useRef(visible);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed) return undefined;
    return focusAccessibility(() => targetRef.current, delayMs);
  }, [visible, targetRef, delayMs]);
}

/**
 * Moves the focus to `targetRef` whenever `key` changes (after the first
 * render): a wizard step, a "sent" confirmation replacing a form, etc.
 */
export function useFocusOnChange(
  key: unknown,
  targetRef: RefObject<A11yFocusTarget | null>,
  delayMs: number = A11Y_FOCUS_DELAY_MS,
): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    return focusAccessibility(() => targetRef.current, delayMs);
  }, [key, targetRef, delayMs]);
}
