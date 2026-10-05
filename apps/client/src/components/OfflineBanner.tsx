import { WifiOff } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { useIsOnline } from "../hooks/useIsOnline";
import { AppText } from "./AppText";

/**
 * Bandeau global « hors ligne » (#416) — monté une fois à la racine
 * (AppNavigator). Discret : fine bande sous la barre de statut, disparaît
 * dès le retour du réseau. Les données affichées restent les dernières
 * connues (cache React Query persisté).
 */
export const OfflineBanner = () => {
  const isOnline = useIsOnline();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  if (isOnline) return null;

  return (
    <View
      style={[
        styles.banner,
        { top: insets.top, backgroundColor: theme.warning },
      ]}
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLabel="Hors ligne — données en cache"
      accessibilityHint="Les informations affichées datent de la dernière connexion"
    >
      <WifiOff size={13} color="#1a1a1a" />
      <AppText variant="caption" color="#1a1a1a" style={styles.text}>
        Hors ligne — données en cache
      </AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 3,
    gap: 6,
    zIndex: 1000,
  },
  text: { fontSize: 12, fontWeight: "600" },
});
