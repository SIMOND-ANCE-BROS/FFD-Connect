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
 * Information banner of a competition editor tab: programme loading or not
 * loadable, competition imported from the FFD (#442).
 */
export const EditorNotice: React.FC<Props> = ({ theme, message, testID }) => (
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
