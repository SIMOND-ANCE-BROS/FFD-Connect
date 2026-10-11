import { Hourglass } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { useRenewalPending } from "../hooks/useRenewalPending";
import { LicenseExpiryBanner } from "./LicenseExpiryBanner";

interface LicenseRenewalBannerProps {
  /** Raw ISO expiry date, passed on to the expiry banner. */
  validUntil: string | Date | null | undefined;
  /** On tap: open the renewal screen. */
  onPress?: () => void;
}

const PENDING_MESSAGE = "Demande de renouvellement en cours de vérification";

/**
 * Licence banner of the Licence and Profile screens (#268). While a renewal
 * request awaits the federation's decision it says so, in place of the
 * expiry banner — which would invite renewing a second time.
 */
export const LicenseRenewalBanner: React.FC<LicenseRenewalBannerProps> = ({
  validUntil,
  onPress,
}) => {
  const { theme } = useTheme();
  const pending = useRenewalPending();

  if (!pending) {
    return <LicenseExpiryBanner validUntil={validUntil} onPress={onPress} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={PENDING_MESSAGE}
      accessibilityHint="Ouvre le suivi de votre demande"
      onPress={onPress}
      testID="license-renewal-pending-banner"
      style={[
        styles.container,
        // ~10% tint of the primary colour (6 → 8 hex digits).
        { backgroundColor: `${theme.primary}1A`, borderColor: theme.primary },
      ]}
    >
      <Hourglass size={20} color={theme.primary} />
      <View style={styles.textWrap}>
        <AppText variant="body" weight="600" color={theme.primary}>
          {PENDING_MESSAGE}
        </AppText>
        <AppText variant="caption" color={theme.textSecondary}>
          Appuyez pour suivre votre demande
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
