import { Hourglass } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";

interface RenewalUnderReviewBannerProps {
  /** Opens the renewal screen, where the request is detailed. */
  onPress?: () => void;
  testID?: string;
}

export const RENEWAL_UNDER_REVIEW_TITLE =
  "Demande de renouvellement en cours de vérification";

/**
 * Shown on the Licence and Profile screens while the licensee's renewal
 * request waits for the administrator's decision (#268). Replaces the expiry
 * banner meanwhile: asking to renew again would be misleading.
 */
export const RenewalUnderReviewBanner: React.FC<
  RenewalUnderReviewBannerProps
> = ({ onPress, testID }) => {
  const { theme } = useTheme();
  const color = theme.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={RENEWAL_UNDER_REVIEW_TITLE}
      accessibilityHint="Ouvre le détail de votre demande de renouvellement"
      onPress={onPress}
      testID={testID ?? "renewal-under-review-banner"}
      style={[
        styles.container,
        { backgroundColor: `${color}1A`, borderColor: color },
      ]}
    >
      <Hourglass size={20} color={color} />
      <View style={styles.textWrap}>
        <AppText variant="body" weight="600" color={color}>
          {RENEWAL_UNDER_REVIEW_TITLE}
        </AppText>
        <AppText variant="caption" color={theme.textSecondary}>
          Vos documents sont en cours de vérification. Vous serez informé dès
          qu’une décision sera prise.
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
