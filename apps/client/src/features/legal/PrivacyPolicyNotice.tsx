import React, { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../components/AppButton";
import { AppText } from "../../components/AppText";
import { useTheme } from "../../context/ThemeContext";
import { usePrivacyPolicyNoticeStore } from "../../stores/privacyPolicyNotice.store";

export const PRIVACY_NOTICE_TITLE =
  "La politique de confidentialité a été mise à jour";

interface PrivacyPolicyNoticeProps {
  /** Signed-in account (not a guest), outside a support session. */
  eligible: boolean;
  /** Opens the privacy policy (Legal screen). */
  onOpenPolicy: () => void;
}

/**
 * Notice of a substantial change to the privacy policy (#734, policy §11).
 *
 * Information, not consent: a card floating above the bottom of the app — not
 * a modal — so the app stays usable while it is shown, and it never stacks
 * with the CGU acceptance modal. Both actions dismiss it for good (the user
 * was told): « Lire la politique » also opens the text.
 *
 * Not shown to guests (no account to remember it on) nor during a support
 * session: a staff member must not dismiss it on the user's behalf.
 */
export const PrivacyPolicyNotice = ({
  eligible,
  onOpenPolicy,
}: PrivacyPolicyNoticeProps) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const pendingVersion = usePrivacyPolicyNoticeStore((s) => s.pendingVersion);
  const check = usePrivacyPolicyNoticeStore((s) => s.check);
  const acknowledge = usePrivacyPolicyNoticeStore((s) => s.acknowledge);
  const reset = usePrivacyPolicyNoticeStore((s) => s.reset);

  useEffect(() => {
    if (eligible) {
      void check();
    } else {
      reset();
    }
  }, [eligible, check, reset]);

  const visible = eligible && pendingVersion !== null;

  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility(PRIVACY_NOTICE_TITLE);
    }
  }, [visible]);

  if (!visible) return null;

  const handleRead = () => {
    void acknowledge();
    onOpenPolicy();
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { bottom: insets.bottom + 72 }]}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
        accessibilityLiveRegion="polite"
        testID="privacy-policy-notice"
      >
        <AppText
          variant="h3"
          color={theme.text}
          accessibilityRole="header"
          style={styles.title}
        >
          {PRIVACY_NOTICE_TITLE}
        </AppText>
        <AppText variant="body" color={theme.textSecondary}>
          Découvrez ce qui change dans la façon dont vos données sont traitées.
          Rien à accepter : ce message est une simple information.
        </AppText>
        <View style={styles.actions}>
          <AppButton
            title="Lire la politique"
            variant="outline"
            onPress={handleRead}
            testID="privacy-policy-notice-read"
            accessibilityLabel="Lire la politique de confidentialité"
            accessibilityHint="Ouvre la politique de confidentialité et ferme ce message"
          />
          <AppButton
            title="J'ai compris"
            onPress={() => void acknowledge()}
            testID="privacy-policy-notice-ack"
            accessibilityLabel="J'ai compris, fermer le message sur la politique de confidentialité"
            accessibilityHint="Ce message ne s'affichera plus pour cette version"
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { marginBottom: 2 },
  actions: { gap: 8, marginTop: 4 },
});
