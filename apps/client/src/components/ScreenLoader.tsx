import React from "react";
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useWakeStore } from "../stores/wake.store";

interface ScreenLoaderProps {
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * First-load loader shared by the list screens (Career, Library): a single
 * centered large ActivityIndicator, same look as the Competitions loader.
 *
 * Hidden while the blocking wake overlay is shown — the overlay has its own
 * spinner, so only one spinner is ever on screen.
 */
export const ScreenLoader = ({ testID, style }: ScreenLoaderProps) => {
  const { theme } = useTheme();
  const wakeOverlayVisible = useWakeStore((s) => s.waking && s.visible);

  if (wakeOverlayVisible) return null;

  return (
    <View
      testID={testID}
      style={[styles.loader, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Chargement"
      accessibilityHint="Le contenu s'affichera dès qu'il sera chargé"
    >
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
};

const styles = StyleSheet.create({
  loader: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
