import { ShieldAlert } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "../../components/AppText";
import { useTheme } from "../../context/ThemeContext";
import { consentCopy, needsParentalAction } from "./parentalConsent";
import { useParentalConsent } from "./useParentalConsent";

interface ParentalConsentBannerProps {
  /** On tap: open the parental consent screen. */
  onPress: () => void;
}

/**
 * Pending-consent banner of a minor's account (#61). Renders nothing for an
 * adult, an account of unknown age, a granted consent, a guest — or while
 * the state is loading or unreadable (the backend gate still refuses the
 * certificate).
 */
export const ParentalConsentBanner: React.FC<ParentalConsentBannerProps> = ({
  onPress,
}) => {
  const { theme } = useTheme();
  const { consent } = useParentalConsent();

  if (!consent || !needsParentalAction(consent)) return null;
  const copy = consentCopy(consent);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.title}
      accessibilityHint="Ouvre l'accord parental"
      onPress={onPress}
      testID="parental-consent-banner"
      style={[
        styles.container,
        // ~10% tint of the warning colour (6 → 8 hex digits).
        { backgroundColor: `${theme.warning}1A`, borderColor: theme.warning },
      ]}
    >
      <ShieldAlert size={20} color={theme.warningText} />
      <View style={styles.textWrap}>
        <AppText variant="body" weight="600" color={theme.text}>
          {copy.title}
        </AppText>
        <AppText variant="caption" color={theme.textSecondary}>
          {consent.state === "PENDING"
            ? "Appuyez pour voir la demande ou la renvoyer"
            : "Appuyez pour indiquer l'e-mail d'un parent"}
        </AppText>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  textWrap: { flex: 1 },
});
