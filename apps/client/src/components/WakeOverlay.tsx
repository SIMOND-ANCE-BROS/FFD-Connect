import React from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useWakeStore } from "../stores/wake.store";

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

  if (!waking || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.title, { color: theme.text }]}>
            Réveil du serveur…
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Le serveur démarre, ça prend environ 90 secondes. Merci de
            patienter.
          </Text>
          <Text style={[styles.timer, { color: theme.textSecondary }]}>
            {elapsed}s
          </Text>
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
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  timer: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
});
