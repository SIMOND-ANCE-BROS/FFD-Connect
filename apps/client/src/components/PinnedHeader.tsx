import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { AppTheme } from "../context/ThemeContext";

/** Hauteur de la barre de titre (hors safe-area et hors contenu épinglé). */
export const PINNED_HEADER_BAR = 56;

/** Le flou déborde de cette hauteur sous le contenu pour s'y estomper. */
const FADE_TAIL = 28;

interface PinnedHeaderProps {
  theme: AppTheme;
  isDark: boolean;
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Contenu épinglé sous le titre (recherche, filtres…) — toujours visible,
   *  sur le verre ; la liste défile dessous. */
  children?: React.ReactNode;
  /** Remonte la hauteur mesurée du contenu pour caler le paddingTop de la liste. */
  onHeightChange?: (height: number) => void;
}

/**
 * En-tête « verre » FIXE (#glass-header). Le titre + la recherche + les filtres
 * restent épinglés et flous ; la liste défile dessous. Le fond flou s'estompe en
 * bas via un masque dégradé (même fondu « smootherstep » que GlassHeader) → pas
 * de démarcation franche. Nécessite @react-native-masked-view (build natif).
 */
export const PinnedHeader = ({
  theme,
  isDark,
  title,
  left,
  right,
  children,
  onHeightChange,
}: PinnedHeaderProps) => {
  const insets = useSafeAreaInsets();
  const [contentH, setContentH] = useState(insets.top + 120);

  const total = contentH + FADE_TAIL;
  const solidStop = Math.min(0.92, contentH / total);
  const span = 1 - solidStop;

  return (
    <View
      style={styles.container}
      pointerEvents="box-none"
      testID="pinned-header"
    >
      {/* Fond flou : déborde de FADE_TAIL sous le contenu et s'y estompe (masque
          smootherstep, pente nulle en sortie de plateau → aucun bord net). */}
      <View
        style={[StyleSheet.absoluteFill, { bottom: -FADE_TAIL }]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={[
                "rgba(0,0,0,1)",
                "rgba(0,0,0,1)",
                "rgba(0,0,0,0.9)",
                "rgba(0,0,0,0.5)",
                "rgba(0,0,0,0.1)",
                "rgba(0,0,0,0)",
              ]}
              locations={[
                0,
                solidStop,
                solidStop + 0.25 * span,
                solidStop + 0.5 * span,
                solidStop + 0.75 * span,
                1,
              ]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            intensity={isDark ? 50 : 70}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? "rgba(0,0,0,0.18)"
                  : "rgba(255,255,255,0.28)",
              },
            ]}
          />
        </MaskedView>
      </View>

      {/* Contenu opaque au-dessus du flou (non masqué). */}
      <View
        style={{ paddingTop: insets.top }}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          setContentH(h);
          onHeightChange?.(h);
        }}
      >
        <View style={styles.bar}>
          {left ? <View style={styles.left}>{left}</View> : null}
          <AppText
            variant="h3"
            color={theme.text}
            numberOfLines={1}
            style={styles.title}
          >
            {title}
          </AppText>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  bar: {
    height: PINNED_HEADER_BAR,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  left: {
    justifyContent: "center",
    marginRight: 4,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  // Titre aligné à gauche : ne bouge jamais quel que soit le nombre d'icônes.
  // marginBottom:0 annule le marginBottom:8 hérité de la typo h3, qui décalait
  // le titre vers le haut par rapport au chevron de retour et aux icônes.
  title: {
    flex: 1,
    marginBottom: 0,
  },
});
