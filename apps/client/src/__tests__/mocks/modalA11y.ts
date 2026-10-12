import { StyleSheet } from "react-native";

/**
 * Shared assertions for the "sibling backdrop" modal pattern (issue #356).
 *
 * On iOS a Pressable / TouchableOpacity is `accessible` by default, so
 * VoiceOver reads it as ONE element and hides its children. A modal whose
 * closing backdrop wraps the card therefore makes every field unreachable.
 * The expected layout (see SpaceSheet) is: container View > [backdrop
 * Pressable in absoluteFill, card View] — backdrop and card are siblings.
 */

/** Minimal shape of an RNTL host element (avoids importing test-renderer). */
interface HostNode {
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: readonly unknown[];
}

/**
 * Asserts that:
 * - the card and its ancestors do not set `accessible={true}` (the prop a
 *   Pressable / TouchableOpacity sets by default) and the card is not inside
 *   the backdrop. Only the `accessible` prop is checked, not every other way
 *   an element can group its children for a screen reader;
 * - the backdrop is a "button" with no child at all;
 * - the backdrop fills its container (absoluteFill) and comes before the
 *   card branch in their common parent, so it is rendered underneath.
 */
export function expectSiblingBackdrop(backdrop: HostNode, card: HostNode) {
  expect(card.props.accessible).not.toBe(true);

  let ancestor = card.parent;
  while (ancestor) {
    expect(ancestor).not.toBe(backdrop);
    expect(ancestor.props.accessible).not.toBe(true);
    ancestor = ancestor.parent;
  }

  expect(backdrop.props.accessibilityRole).toBe("button");
  expect(backdrop.children).toHaveLength(0);

  // absoluteFill: the backdrop covers the whole container.
  expect(
    StyleSheet.flatten(
      backdrop.props.style as Parameters<typeof StyleSheet.flatten>[0],
    ),
  ).toEqual(
    expect.objectContaining({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }),
  );

  // Order: in the backdrop's parent, the backdrop precedes the branch that
  // holds the card, so the card is drawn (and hit-tested) above it.
  const container = backdrop.parent;
  expect(container).not.toBeNull();
  let cardBranch: HostNode | null = card;
  while (cardBranch && cardBranch.parent !== container) {
    cardBranch = cardBranch.parent;
  }
  expect(cardBranch).not.toBeNull();
  const siblings = container?.children ?? [];
  expect(siblings.indexOf(backdrop)).toBeGreaterThanOrEqual(0);
  expect(siblings.indexOf(backdrop)).toBeLessThan(siblings.indexOf(cardBranch));
}
