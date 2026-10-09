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
 * Bandeau permanent d'impersonation (#545). Rappelle en continu qu'on agit
 * « en tant que » un tiers et permet de sortir à tout moment. Rendu dans le
 * flux de mise en page par `TopBannersLayout` (jamais en surimpression).
 *
 * `visible` : décidé par `TopBannersLayout` (seule source de vérité, pour
 * que le bandeau affiché et les marges remises à zéro ne divergent jamais).
 * `topInset` : marge haute à absorber (barre de statut). Fournie par
 * `TopBannersLayout`, qui la donne au premier bandeau visible de la pile.
 */
export const ImpersonationBanner = ({
  visible,
  topInset,
}: {
  visible: boolean;
  topInset?: number;
}) => {
  const name = useAuthStore((s) => s.impersonatedName);
  const refreshAuth = useAuthStore((s) => s.refreshAuth);
  const insets = useSafeAreaInsets();
  const [stopping, setStopping] = useState(false);

  if (!visible) return null;

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
        { paddingTop: topInset ?? insets.top, backgroundColor: "#8e44ad" },
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
