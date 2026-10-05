import { BlurView } from "expo-blur";
import React from "react";
import { StyleSheet } from "react-native";
import {
  KeyboardToolbar,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";
import { useTheme } from "../context/ThemeContext";

/**
 * Barre clavier "verre" alignée iOS 26 (Liquid Glass approximé).
 *
 * keyboard-controller rend une View React, pas l'accessoire natif d'iOS, donc
 * elle n'hérite pas du vrai matériau système. On approxime : fond du toolbar
 * transparent (opacity "00") + un BlurView translucide en arrière-plan via le
 * prop `blur`. Les flèches prev/next et le bouton Terminé restent gérés
 * automatiquement par keyboard-controller.
 */
export const GlassKeyboardToolbar = () => {
  const { theme, isDark } = useTheme();

  // Fond transparent (opacity "00") : seul le BlurView fournit le visuel.
  const toolbarTheme: KeyboardToolbarProps["theme"] = {
    light: {
      primary: theme.primary,
      disabled: "#B0B0B0",
      background: "#000000",
      ripple: "#00000018",
    },
    dark: {
      primary: theme.primary,
      disabled: "#5A5A5A",
      background: "#000000",
      ripple: "#FFFFFF18",
    },
  };

  return (
    <KeyboardToolbar
      opacity="00"
      theme={toolbarTheme}
      doneText="Terminé"
      blur={
        <BlurView
          tint={
            isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"
          }
          intensity={60}
          style={StyleSheet.absoluteFill}
        />
      }
    />
  );
};
