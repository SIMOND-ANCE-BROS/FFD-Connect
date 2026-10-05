import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { AppTheme } from "../context/ThemeContext";

/** Hauteur de la barre (hors safe-area haut). */
export const GLASS_HEADER_HEIGHT = 56;

/** Distance de scroll sur laquelle le fond passe de transparent → verre dépoli.
 *  Bas = le flou apparaît tôt au défilement. */
const FADE_DISTANCE = 40;

/**
 * Le flou déborde de cette hauteur SOUS la barre, dans le contenu, pour que le
 * fondu se termine par-dessus les premiers pixels du contenu (comme iOS) plutôt
 * qu'au ras de la barre.
 */
const FADE_TAIL = 72;

interface GlassHeaderProps {
  theme: AppTheme;
  isDark: boolean;
  title: string;
  /** Valeur de défilement (Animated) pilotant l'apparition du fond. */
  scrollY: Animated.Value;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

/**
 * En-tête « liquid glass » (#glass-header) : superposé au contenu, transparent
 * en haut puis verre dépoli qui apparaît au défilement (façon iOS 26).
 *
 * Vrai flou progressif : un unique BlurView est masqué par un dégradé vertical
 * (opaque en haut → transparent en bas) via MaskedView. C'est le flou LUI-MÊME
 * qui s'efface — aucun bord ni marche, contrairement à un empilement de bandes.
 * Nécessite le module natif `@react-native-masked-view/masked-view` (donc un
 * build natif, pas juste une OTA).
 */
export const GlassHeader = ({
  theme,
  isDark,
  title,
  scrollY,
  left,
  right,
}: GlassHeaderProps) => {
  const insets = useSafeAreaInsets();

  // Opacité (native driver) du fond : 0 en haut, 1 après défilement.
  const bgOpacity = scrollY.interpolate({
    inputRange: [0, FADE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  // Le masque reste PLEIN sur toute la barre (safe-area + titre + icônes) puis
  // ne s'estompe que dans le tail, sous la barre. Ainsi les icônes/titre sont
  // franchement dans le flou, et le fondu se joue seulement par-dessus le
  // contenu qui défile.
  const totalHeight = insets.top + GLASS_HEADER_HEIGHT + FADE_TAIL;
  const solidStop = Math.min(
    0.85,
    (insets.top + GLASS_HEADER_HEIGHT) / totalHeight,
  );
  // Falloff en « smootherstep » : l'alpha quitte le plateau plein avec une
  // pente NULLE (pas de coin), donc aucune ligne au passage flou plein → fondu.
  // Échantillons de 1-(6t⁵-15t⁴+10t³) à t=0,.25,.5,.75,1 sur [solidStop, 1].
  const span = 1 - solidStop;

  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
      pointerEvents="box-none"
      testID="glass-header"
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { bottom: -FADE_TAIL, opacity: bgOpacity },
        ]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            // Alpha du masque : plein en haut (flou visible) → 0 en bas (flou
            // effacé). Le flou s'estompe donc réellement, sans bord net.
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
            intensity={isDark ? 45 : 65}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          {/* Teinte « matière » légère par-dessus le flou (masquée aussi). */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? "rgba(0,0,0,0.22)"
                  : "rgba(255,255,255,0.35)",
              },
            ]}
          />
        </MaskedView>
      </Animated.View>

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
    height: GLASS_HEADER_HEIGHT,
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
  // Titre aligné à gauche : position stable quel que soit le nombre d'icônes.
  // marginBottom:0 annule le marginBottom:8 hérité de la typo h3, qui décalait
  // verticalement le titre par rapport au chevron de retour et aux icônes.
  title: {
    flex: 1,
    marginBottom: 0,
  },
});
