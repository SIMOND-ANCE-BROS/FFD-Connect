/**
 * Point d'entrée web : imports explicites des versions .web
 * Garantit qu'aucun module mobile-only (TrackPlayer, expo-camera) n'est chargé
 */
import React from "react";
import { Dimensions, LogBox, StatusBar, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { AuthProvider } from "./src/features/auth/context/AuthContext";
import { AuthService } from "./src/features/auth/services/AuthService";
import {
  ClubProvider,
  defaultClubRepository,
} from "./src/features/club/context/ClubContext";
import { CompetitionProvider } from "./src/features/competitions/context/CompetitionContext";
import { PerformanceProvider } from "./src/features/performance/context/PerformanceContext.web";
import { LibraryProvider } from "./src/features/player/context/LibraryContext";
import { PlayerProvider } from "./src/features/player/context/PlayerContext.web";
import { TrackProvider } from "./src/features/player/context/TrackContext";
import { TrackService } from "./src/features/player/services/TrackService";
import { AppNavigator } from "./src/navigation/AppNavigator";

if (__DEV__) {
  LogBox.ignoreLogs([
    "Request failed with status code 401",
    "AxiosError: Request failed with status code 401",
  ]);
}

const trackService = new TrackService();

/** Métriques initiales pour SafeAreaProvider sur le web (pas d'API native) */
const getWebInitialMetrics = () => {
  try {
    const { width, height } = Dimensions.get("window");
    return {
      frame: { x: 0, y: 0, width: width || 375, height: height || 812 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    };
  } catch {
    return {
      frame: { x: 0, y: 0, width: 375, height: 812 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    };
  }
};

const ThemedAppContent = () => {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar
        barStyle={theme.statusBarStyle}
        backgroundColor={theme.background}
      />
      <AppNavigator />
    </>
  );
};

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={getWebInitialMetrics()}>
        <ErrorBoundary>
          <AuthProvider implementation={AuthService}>
            <ThemeProvider>
              <ClubProvider implementation={defaultClubRepository}>
                <TrackProvider implementation={trackService}>
                  <LibraryProvider>
                    <PlayerProvider>
                      <PerformanceProvider>
                        <CompetitionProvider>
                          <ThemedAppContent />
                        </CompetitionProvider>
                      </PerformanceProvider>
                    </PlayerProvider>
                  </LibraryProvider>
                </TrackProvider>
              </ClubProvider>
            </ThemeProvider>
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default App;
