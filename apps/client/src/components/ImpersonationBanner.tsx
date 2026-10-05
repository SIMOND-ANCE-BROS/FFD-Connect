import { UserCog, X } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { AuthService } from "../features/auth/services/AuthService";
import { useAuthStore } from "../stores/auth.store";
import { createLogger } from "../utils/logger";

const logger = createLogger("ImpersonationBanner");

/**
 * Bandeau permanent d'impersonation (#545) — monté à la racine. Rappelle en
 * continu qu'on agit « en tant que » un tiers et permet de sortir à tout moment.
 */
export const ImpersonationBanner = () => {
  const impersonating = useAuthStore((s) => s.impersonating);
  const name = useAuthStore((s) => s.impersonatedName);
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const insets = useSafeAreaInsets();
  const [stopping, setStopping] = useState(false);

  if (!impersonating) return null;

  const handleStop = () => {
    setStopping(true);
    AuthService.stopImpersonation()
      .then(() => refreshAuth())
      .catch((e) => logger.error("stopImpersonation failed", e))
      .finally(() => setStopping(false));
  };

  return (
    <View
      style={[
        styles.banner,
        { paddingTop: insets.top, backgroundColor: "#8e44ad" },
      ]}
      testID="impersonation-banner"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <UserCog size={16} color="#fff" />
        <AppText
          variant="caption"
          color="#fff"
          style={styles.text}
          numberOfLines={1}
        >
          Vous agissez en tant que {name ?? "un utilisateur"}
        </AppText>
        <TouchableOpacity
          onPress={handleStop}
          disabled={stopping}
          accessibilityRole="button"
          accessibilityLabel="Quitter l'impersonation"
          accessibilityHint="Revient à votre session d'origine"
          testID="impersonation-stop"
          style={styles.quit}
          hitSlop={8}
        >
          <AppText variant="caption" color="#fff" style={styles.quitText}>
            {stopping ? "…" : "Quitter"}
          </AppText>
          <X size={14} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2000,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 8,
  },
  text: { flex: 1, fontWeight: "600" },
  quit: { flexDirection: "row", alignItems: "center", gap: 3 },
  quitText: { fontWeight: "700" },
});
