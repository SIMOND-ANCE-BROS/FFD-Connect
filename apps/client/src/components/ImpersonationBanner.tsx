import { UserCog, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { AuthService } from "../features/auth/services/AuthService";
import { useAuthStore } from "../stores/auth.store";
import { createLogger } from "../utils/logger";

const logger = createLogger("ImpersonationBanner");

/**
 * Bandeau permanent d'impersonation (#545). Rappelle en continu qu'on agit
 * « en tant que » un tiers et permet de sortir à tout moment. Rendu dans le
 * flux de mise en page par `ImpersonationLayout` (jamais en surimpression).
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

interface ImpersonationLayoutProps {
  children: React.ReactNode;
}

/**
 * Root layout that keeps the impersonation banner from masking anything.
 *
 * The banner used to be absolutely positioned over the whole app, so it hid
 * every screen's header (PinnedHeader / GlassHeader titles, back buttons,
 * header actions). It now sits in the layout flow, above the app, and pushes
 * it down. Since the banner already absorbs the status-bar inset, the app
 * below it is given a top safe-area inset of 0: every header that pads itself
 * with `useSafeAreaInsets().top` lands right under the banner, and native
 * `SafeAreaView`s compute 0 on their own (they are no longer under the status
 * bar). Bottom/side insets are untouched.
 *
 * The element tree is identical whether or not impersonation is active, so
 * starting/stopping it never remounts the navigator (navigation state kept).
 * Caveat: a `<Modal>` rendered by a screen inherits the overridden inset; no
 * modal currently relies on the top inset.
 */
export const ImpersonationLayout = ({ children }: ImpersonationLayoutProps) => {
  const impersonating = useAuthStore((s) => s.impersonating);
  const insets = useSafeAreaInsets();
  const appInsets = useMemo(
    () => (impersonating ? { ...insets, top: 0 } : insets),
    [impersonating, insets],
  );

  return (
    <View style={styles.layout}>
      <ImpersonationBanner />
      <View style={styles.layout}>
        <SafeAreaInsetsContext.Provider value={appInsets}>
          {children}
        </SafeAreaInsetsContext.Provider>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  layout: { flex: 1 },
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
