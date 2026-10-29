import React, { useEffect } from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useWakeStore } from "../stores/wake.store";
import { announce } from "../utils/announce";
import { AppText } from "./AppText";

/** Spoken once when the overlay appears (the per-second timer stays silent). */
export const WAKE_OVERLAY_ANNOUNCEMENT =
  "Réveil du serveur, merci de patienter";

/**
 * Expected wait. The measured cold start is 30–60 s (image pull + migrations +
 * NestJS boot), so "about a minute" stays honest without overpromising.
 */
export const WAKE_OVERLAY_SUBTITLE =
  "Le serveur démarre, ça prend environ une minute. Merci de patienter.";

const noop = () => {};

/**
 * Overlay plein écran affiché pendant le réveil du backend (Container App
 * endormi qui redémarre). Bloque l'interaction et rassure l'utilisateur avec
 * un compteur. Reste masqué pendant un pré-réveil silencieux (visible=false).
 */
export const WakeOverlay = (): React.JSX.Element | null => {
  const { theme } = useTheme();
  const waking = useWakeStore((s) => s.waking);
  const visible = useWakeStore((s) => s.visible);
  const elapsed = useWakeStore((s) => s.elapsed);
  const shown = waking && visible;

  // Screen readers get one sentence when the wait starts, not the ticking
  // counter (no live region on it).
  useEffect(() => {
    if (shown) announce(WAKE_OVERLAY_ANNOUNCEMENT);
  }, [shown]);

  if (!shown) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // The wait cannot be skipped: Android back does nothing (and RN warns
      // when a Modal has no handler).
      onRequestClose={noop}
    >
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: theme.surface }]}
          accessibilityViewIsModal
        >
          <ActivityIndicator
            size="large"
            color={theme.primary}
            accessibilityLabel="Chargement"
            accessibilityHint="Le serveur redémarre"
          />
          <AppText
            variant="h3"
            weight="bold"
            accessibilityRole="header"
            color={theme.text}
            style={styles.title}
          >
            Réveil du serveur…
          </AppText>
          <AppText
            variant="body"
            color={theme.textSecondary}
            style={styles.subtitle}
          >
            {WAKE_OVERLAY_SUBTITLE}
          </AppText>
          <AppText
            variant="caption"
            weight="600"
            color={theme.textSecondary}
            style={styles.timer}
          >
            {elapsed}s
          </AppText>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 18,
    marginBottom: 0,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  timer: {
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
});
