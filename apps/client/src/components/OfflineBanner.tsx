import { WifiOff } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { useIsOnline } from "../hooks/useIsOnline";
import { AppText } from "./AppText";

/**
 * Bandeau global « hors ligne » (#416). Discret : fine bande sous la barre de
 * statut, disparaît dès le retour du réseau. Les données affichées restent
 * les dernières connues (cache React Query persisté).
 *
 * Rendu dans le flux de mise en page par `TopBannersLayout` (jamais en
 * surimpression : en position absolue il masquait les titres et boutons des
 * en-têtes d'écran). `topInset` : marge haute à absorber (barre de statut),
 * 0 quand un autre bandeau au-dessus l'absorbe déjà.
 */
export const OfflineBanner = ({ topInset }: { topInset?: number } = {}) => {
  const isOnline = useIsOnline();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  if (isOnline) return null;

  return (
    <View
      style={[
        styles.banner,
        { paddingTop: topInset ?? insets.top, backgroundColor: theme.warning },
      ]}
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLabel="Hors ligne — données en cache"
      accessibilityHint="Les informations affichées datent de la dernière connexion"
    >
      <View style={styles.row}>
        <WifiOff size={13} color="#1a1a1a" />
        <AppText variant="caption" color="#1a1a1a" style={styles.text}>
          Hors ligne — données en cache
        </AppText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    zIndex: 1000,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 3,
    gap: 6,
  },
  text: { fontSize: 12, fontWeight: "600" },
});
