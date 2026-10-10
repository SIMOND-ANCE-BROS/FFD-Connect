/**
 * FFD Connect
 * @format
 *
 * Debug écran blanc:
 * - En dev: bandeau vert "App OK" = React monte.
 * - En preview: si EXPO_PUBLIC_DEBUG_BOOT=1 (défini dans eas.json preview), bandeau orange "App OK" pour vérifier que le JS rend.
 * - Voir apps/client/docs/DEBUG_ECRAN_BLANC.md pour la procédure complète.
 */

import React, { useEffect } from "react";
import {
  LogBox,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { GlassKeyboardToolbar } from "./src/components/GlassKeyboardToolbar";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { AuthProvider } from "./src/features/auth/context/AuthContext";
import { AuthService } from "./src/features/auth/services/AuthService";
import { PlayerStoreSync } from "./src/components/PlayerStoreSync";
import {
  useClubStore,
  defaultClubRepository,
  initClubLogo,
} from "./src/stores/club.store";
import { LibraryProvider } from "./src/features/player/context/LibraryContext";
import { TrackProvider } from "./src/features/player/context/TrackContext";
import { TrackService } from "./src/features/player/services/TrackService";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { PersistedQueryClientProvider } from "./src/services/queryClient";
import { WakeOverlay } from "./src/components/WakeOverlay";
import { installBackendWake, warmBackend } from "./src/utils/backendWake";
import { analytics, usage } from "./src/services/analytics";
import {
  registerDeviceTokenForPush,
  setupPushListeners,
} from "./src/features/settings/services/pushRegistration";

// Wrappe `fetch` au plus tôt : réveille le Container App si le backend est
// down. Puis pré-réveil silencieux : le backend démarre pendant le
// splash/login au lieu d'attendre la première requête qui échoue.
installBackendWake();
void warmBackend();

// Ignorer les erreurs HTTP 401 dans LogBox (elles sont gérées par l'intercepteur)
if (__DEV__) {
  LogBox.ignoreLogs([
    "Request failed with status code 401",
    "AxiosError: Request failed with status code 401",
  ]);
}

// Singleton instances
const trackService = new TrackService();

// Helper component to consume theme context
const ThemedAppContent = () => {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar
        barStyle={theme.statusBarStyle}
        backgroundColor={theme.background}
      />
      <AppNavigator />
      <WakeOverlay />
      {/* Barre clavier "verre" (prev / next / Terminé) — remplace
          IQKeyboardManager (incompatible RN 0.86) par keyboard-controller,
          avec un fond BlurView aligné iOS 26. */}
      <GlassKeyboardToolbar />
    </>
  );
};

function App(): React.JSX.Element {
  useEffect(() => {
    useClubStore.getState().setRepository(defaultClubRepository);
    void initClubLogo();
  }, []);

  // Lot 5: on background, close the screen view and send usage if the
  // backend is awake (never wakes it).
  useEffect(() => usage.start(() => analytics.endScreen()), []);

  // Push notifications. Foreground listeners (onMessage,
  // getInitialNotification) are wired on every launch, outside the auth flow:
  // getInitialNotification has to be read on the launch a tap caused. The
  // background handler is NOT here — RNFB requires it at module scope, so it
  // is registered in index.js (#775).
  // Token registration also runs here, not only at login: a session restored
  // from the Keychain never goes through login(), so an already signed-in user
  // would otherwise never register a device.
  useEffect(() => {
    setupPushListeners();
    void (async () => {
      const { isLoggedIn, isGuest } = await AuthService.getAuthConfig();
      if (isLoggedIn === true && isGuest !== true) {
        await registerDeviceTokenForPush();
      }
    })();
  }, []);

  // En preview/production le splash peut rester affiché (fond blanc) si on ne le cache pas explicitement
  useEffect(() => {
    if (Platform.OS === "web") return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SplashScreen = require("expo-splash-screen") as {
      hideAsync?: () => Promise<void>;
    };
    if (SplashScreen.hideAsync) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, []);

  const showBootBanner =
    __DEV__ ||
    (typeof process !== "undefined" &&
      process.env.EXPO_PUBLIC_DEBUG_BOOT === "1");

  return (
    <GestureHandlerRootView style={styles.root}>
      {showBootBanner && (
        <View
          style={[styles.debugBanner, !__DEV__ && styles.debugBannerPreview]}
          pointerEvents="none"
        >
          <Text style={styles.debugBannerText}>App OK</Text>
        </View>
      )}
      <KeyboardProvider>
        <ErrorBoundary>
          <PersistedQueryClientProvider>
            <SafeAreaProvider>
              <AuthProvider implementation={AuthService}>
                <ThemeProvider>
                  <TrackProvider implementation={trackService}>
                    <LibraryProvider>
                      <PlayerStoreSync />
                      <ThemedAppContent />
                    </LibraryProvider>
                  </TrackProvider>
                </ThemeProvider>
              </AuthProvider>
            </SafeAreaProvider>
          </PersistedQueryClientProvider>
        </ErrorBoundary>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  debugBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "rgba(0, 100, 0, 0.8)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  debugBannerPreview: {
    backgroundColor: "rgba(200, 100, 0, 0.9)",
  },
  debugBannerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});

export default App;
