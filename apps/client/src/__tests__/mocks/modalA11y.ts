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
 * - the card is not an accessible element, nor nested in one (so its fields
 *   are reachable one by one by a screen reader);
 * - the backdrop is an accessible "button" with no child at all (it wraps
 *   nothing, in particular nothing interactive).
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
}
