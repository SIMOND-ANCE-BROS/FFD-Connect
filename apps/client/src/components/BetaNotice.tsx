import { Info } from "lucide-react-native";
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { useTheme } from "../context/ThemeContext";
import { AppText } from "./AppText";

interface BetaNoticeProps {
  /** Short bold heading (optional). */
  title?: string;
  message: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Sober, non-dismissable information banner used to explain the limits of
 * the beta (not connected to the federation yet). Neutral tint of the theme
 * primary colour — informative, not alarming. The whole banner is one
 * accessibility element (no custom label: the screen reader reads the title
 * then the message, the same text sighted users see).
 * Copy lives in `constants/betaNotices.ts`.
 */
export const BetaNotice: React.FC<BetaNoticeProps> = ({
  title,
  message,
  style,
  testID = "beta-notice",
}) => {
  const { theme } = useTheme();

  return (
    <View
      accessible
      accessibilityRole="text"
      testID={testID}
      style={[
        styles.container,
        // ~8% tint of the primary colour (hex 6 → 8 digits), like the
        // license expiry banner does with its semantic colour.
        {
          backgroundColor: `${theme.primary}14`,
          borderColor: `${theme.primary}40`,
        },
        style,
      ]}
    >
      <Info size={18} color={theme.primary} style={styles.icon} />
      <View style={styles.textWrap}>
        {title ? (
          <AppText variant="caption" weight="600" color={theme.text}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="caption" color={theme.textSecondary}>
          {message}
        </AppText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  icon: { marginTop: 1 },
  textWrap: { flex: 1, gap: 2 },
});
