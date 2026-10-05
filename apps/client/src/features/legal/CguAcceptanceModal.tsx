import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { AppButton } from "../../components/AppButton";
import { AppText } from "../../components/AppText";
import { useTheme } from "../../context/ThemeContext";
import { acceptCgu, hasAcceptedCgu } from "./cguConsent";
import { LEGAL_DOCUMENTS } from "./legalContent";

/**
 * Acceptation des CGU au premier lancement (#424).
 *
 * Autonome : monte-la une fois à la racine (AppNavigator) ; elle vérifie
 * elle-même l'état d'acceptation et ne rend rien si les CGU (version
 * courante) sont déjà acceptées. Le texte intégral est scrollable dans la
 * modale — pas de dépendance à la navigation.
 */
export const CguAcceptanceModal = () => {
  const { theme } = useTheme();
  // null = état inconnu (lecture AsyncStorage en cours) → ne rien afficher.
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    hasAcceptedCgu()
      .then(setAccepted)
      .catch(() => setAccepted(true));
  }, []);

  if (accepted !== false) return null;

  const cgu = LEGAL_DOCUMENTS.cgu;

  const handleAccept = () => {
    setAccepted(true);
    acceptCgu().catch(() => {});
  };

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <AppText variant="h2" color={theme.text} style={styles.title}>
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
    paddingBottom: 32,
  },
  title: { marginBottom: 4 },
  scroll: { marginVertical: 14 },
  scrollContent: { paddingBottom: 8 },
  section: { marginBottom: 14 },
  sectionHeading: { marginBottom: 4 },
});
