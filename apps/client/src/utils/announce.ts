import { AccessibilityInfo, Platform } from "react-native";

/**
 * Speaks a message through the active screen reader (VoiceOver / TalkBack)
 * without moving focus — for transient feedback that is only shown visually
 * (inline errors, "ajouté à la file", confirmations). No-op when the message
 * is empty. Alerts (`Alert.alert`) are read natively and do not need this.
 *
 * On iOS the announcement is queued so it does not cut off what VoiceOver is
 * currently reading (e.g. the label of the button that was just activated).
 */
export function announce(message: string | null | undefined): void {
  const text = message?.trim();
  if (!text) return;
  if (Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibilityWithOptions(text, {
      queue: true,
    });
    return;
  }
  AccessibilityInfo.announceForAccessibility(text);
}
