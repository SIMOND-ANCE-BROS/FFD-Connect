import { AlertTriangle } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { computeLicenseExpiry } from "../utils/licenseExpiry";

interface LicenseExpiryBannerProps {
  /** Date d'expiration ISO brute (pas la chaîne `validUntil` déjà formatée). */
  validUntil: string | Date | null | undefined;
  /** Action au tap (typiquement : naviguer vers le renouvellement). */
  onPress?: () => void;
  /** Date de référence, injectable pour les tests. */
  now?: Date;
  testID?: string;
}

/**
 * Bannière d'alerte affichée quand la licence expire bientôt ou est expirée
 * (MVP-5). Ne rend rien tant que la licence est valide (> 30 jours).
 * Couleurs sémantiques : orange ≤30j, rouge ≤7j, gris expirée.
 */
export const LicenseExpiryBanner: React.FC<LicenseExpiryBannerProps> = ({
  validUntil,
  onPress,
  now,
  testID,
}) => {
  const { theme } = useTheme();
  const { status, days } = computeLicenseExpiry(validUntil, now);

  if (status === "valid") return null;

  // Expirée ou urgente (≤ 7 j) → rouge ; sinon (≤ 30 j) → orange.
  const color =
    status === "urgent" || status === "expired" ? theme.danger : theme.warning;

  const remaining = days ?? 0;
  const message =
    status === "expired"
      ? "Votre licence a expiré"
      : remaining === 0
        ? "Votre licence expire aujourd'hui"
        : `Votre licence expire dans ${remaining} jour${remaining > 1 ? "s" : ""}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint="Ouvre le renouvellement de licence"
      onPress={onPress}
      testID={testID ?? "license-expiry-banner"}
      style={[
        styles.container,
        // Fond teinté ~10% de la couleur sémantique (hex 6 → 8 chiffres).
        { backgroundColor: `${color}1A`, borderColor: color },
      ]}
    >
      <AlertTriangle size={20} color={color} />
      <View style={styles.textWrap}>
        <AppText variant="body" weight="600" color={color}>
          {message}
        </AppText>
        <AppText variant="caption" color={theme.textSecondary}>
          Appuyez pour renouveler
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
