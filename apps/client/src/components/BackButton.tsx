import { ChevronLeft } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, ViewStyle } from "react-native";
import { useTheme } from "../context/ThemeContext";

interface BackButtonProps {
  onPress: () => void;
  /** Surcharge de couleur (par défaut theme.text). */
  color?: string;
  size?: number;
  style?: ViewStyle;
}

/**
 * Bouton retour unifié de toute l'app : chevron ‹ (28, theme.text), en haut à
 * gauche des sous-écrans. Remplace le mélange ChevronLeft/ArrowLeft/header natif.
 * Les vraies modales plein écran gardent leur ✕ de fermeture.
 */
export const BackButton = ({
  onPress,
  color,
  size = 28,
  style,
}: BackButtonProps) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Retour"
      accessibilityHint="Revenir à l'écran précédent"
      testID="back-button"
      hitSlop={10}
      style={[styles.button, style]}
    >
      <ChevronLeft size={size} color={color ?? theme.text} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    marginLeft: -6,
    alignItems: "center",
    justifyContent: "center",
  },
});
