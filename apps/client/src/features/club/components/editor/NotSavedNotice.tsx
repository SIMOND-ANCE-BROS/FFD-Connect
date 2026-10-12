import { Info } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";

interface Props {
  theme: AppTheme;
  message: string;
  testID?: string;
}

/**
 * Tells the club that a tab of the competition editor is a preview whose
 * content isn't saved with the competition (#417: the API has no write path
 * for a competition's events or schedule yet).
 */
export const NotSavedNotice: React.FC<Props> = ({ theme, message, testID }) => (
  <View
    testID={testID}
    accessibilityRole="text"
    style={[styles.notice, { backgroundColor: `${theme.primary}14` }]}
  >
    <Info size={16} color={theme.primary} />
    <AppText
      variant="caption"
      style={[styles.text, { color: theme.textSecondary }]}
    >
      {message}
    </AppText>
  </View>
);

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
  },
  text: { flex: 1 },
});
