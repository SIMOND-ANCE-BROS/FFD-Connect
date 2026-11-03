import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../components/AppButton";
import { AppText } from "../../components/AppText";
import { useTheme } from "../../context/ThemeContext";
import { acceptCgu, CguSubject, needsCguAcceptance } from "./cguConsent";
import { currentCguSubject } from "./cguSubject";
import { LEGAL_DOCUMENTS } from "./legalContent";

interface CguAcceptanceModalProps {
  /**
   * A session that may be asked: signed in (account or guest) and not a
   * support session. Its changes (sign-in, sign-out, guest, impersonation)
   * re-run the check for the new identity.
   */
  active: boolean;
  /** Guest session: the acceptance belongs to the device, not an account. */
  isGuest: boolean;
}

/**
 * Acceptation des CGU (#424), par compte (#894).
 *
 * Montée une fois à la racine (AppNavigator) ; elle vérifie elle-même si la
 * session en cours a accepté la version courante (le compte côté serveur, un
 * invité sur l'appareil) et ne rend rien sinon. Le texte intégral est
 * scrollable dans la modale — pas de dépendance à la navigation.
 */
export const CguAcceptanceModal = ({
  active,
  isGuest,
}: CguAcceptanceModalProps) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  // Who is asked; null = nobody (state unknown, accepted, or not eligible).
  const [pending, setPending] = useState<CguSubject | null>(null);

  useEffect(() => {
    setPending(null);
    if (!active) return;
    // The identity may change while the check is in flight: a stale answer
    // must never ask the next session.
    const run = { current: true };
    void (async () => {
      try {
        const subject = await currentCguSubject();
        if (!subject || !(await needsCguAcceptance(subject))) return;
        if (run.current) setPending(subject);
      } catch {
        // Unreadable state: never block the app, asked again next launch.
      }
    })();
    return () => {
      run.current = false;
    };
  }, [active, isGuest]);

  if (!active || pending === null) return null;

  const cgu = LEGAL_DOCUMENTS.cgu;

  const handleAccept = () => {
    setPending(null);
    void acceptCgu(pending);
  };

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              // The accept button stays above the home indicator.
              paddingBottom: Math.max(32, insets.bottom + 20),
            },
          ]}
          accessibilityViewIsModal
        >
          <AppText
            variant="h2"
            color={theme.text}
            style={styles.title}
            accessibilityRole="header"
          >
            Conditions générales d'utilisation
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            Dernière mise à jour : {cgu.updatedAt}
          </AppText>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            testID="cgu-modal-scroll"
          >
            {cgu.sections.map((section, index) => (
              <View key={index} style={styles.section}>
                {section.heading ? (
                  <AppText
                    variant="h3"
                    color={theme.text}
                    style={styles.sectionHeading}
                    accessibilityRole="header"
                  >
                    {section.heading}
                  </AppText>
                ) : null}
                <AppText variant="body" color={theme.textSecondary}>
                  {section.body}
                </AppText>
              </View>
            ))}
          </ScrollView>

          <AppButton
            title="J'accepte les conditions"
            onPress={handleAccept}
            testID="cgu-accept-button"
            accessibilityLabel="Accepter les conditions générales d'utilisation"
            accessibilityHint="Enregistre votre acceptation et ferme la fenêtre"
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  title: { marginBottom: 4 },
  scroll: { marginVertical: 14 },
  scrollContent: { paddingBottom: 8 },
  section: { marginBottom: 14 },
  sectionHeading: { marginBottom: 4 },
});
