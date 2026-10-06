import {
  CommonActions,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useAuthStore } from "../stores/auth.store";
import { analytics } from "../services/analytics";
import { logger } from "../utils/logger";

// --- Auth screens ---
import { ForgotPasswordScreen } from "../features/auth/screens/ForgotPasswordScreen";
import { LoginScreen } from "../features/auth/screens/LoginScreen";
import { RegisterScreen } from "../features/auth/screens/RegisterScreen";
import { ResetPasswordScreen } from "../features/auth/screens/ResetPasswordScreen";

// --- Club screens ---
import { ClubCompetitionFormScreen } from "../features/club/screens/ClubCompetitionFormScreen";
import { ClubCompetitionsScreen } from "../features/club/screens/ClubCompetitionsScreen";
import { ClubCouplesScreen } from "../features/club/screens/ClubCouplesScreen";
import { ClubDashboardScreen } from "../features/club/screens/ClubDashboardScreen";
import { ClubMemberEditorScreen } from "../features/club/screens/ClubMemberEditorScreen";
import { ClubMembersScreen } from "../features/club/screens/ClubMembersScreen";
import { ClubRegistrationsScreen } from "../features/club/screens/ClubRegistrationsScreen";
import { ClubSoloTeamDetailScreen } from "../features/club/screens/ClubSoloTeamDetailScreen";
import { ClubSoloTeamsScreen } from "../features/club/screens/ClubSoloTeamsScreen";

// --- Competition screens ---
import { CompetitionDetailScreen } from "../features/competitions/screens/CompetitionDetailScreen";
import { EventRegistrantsScreen } from "../features/competitions/screens/EventRegistrantsScreen";
import { LiveResultsScreen } from "../features/competitions/screens/LiveResultsScreen";
import { VolunteerCheckinScreen } from "../features/competitions/screens/VolunteerCheckinScreen";

// --- License screens ---
import { LicenseRenewalScreen } from "../features/license/screens/LicenseRenewalScreen";
import { ScannerScreen } from "../features/license/screens/ScannerScreen";

// --- Player & Performance screens ---
import { AudioPlayerScreen } from "../features/player/screens/AudioPlayerScreen";
import { PerformancePlayerScreen } from "../features/performance/screens/PerformancePlayerScreen";
import { PerformanceSetupScreen } from "../features/performance/screens/PerformanceSetupScreen";

// --- Other screens ---
import { ViewCareerScreen } from "../features/career/screens/ViewCareerScreen";
import { OfflineBanner } from "../components/OfflineBanner";
import { ImpersonationBanner } from "../components/ImpersonationBanner";
import { CguAcceptanceModal } from "../features/legal/CguAcceptanceModal";
import { LegalScreen } from "../features/legal/LegalScreen";

// --- Profile screen ---
import { ProfileScreen } from "../features/profile/screens/ProfileScreen";
import { NotificationsScreen } from "../features/settings/screens/NotificationsScreen";

// --- Components ---
import { MiniPlayer } from "../features/player/components/MiniPlayer";
import { linking } from "./linking";
import { MainTabs } from "./MainTabs";
import { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  const { theme: currentTheme, isDark } = useTheme();
  const { isLoggedIn, refreshAuth, pendingDeepLink, setPendingDeepLink } =
    useAuthStore();
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>(
    "Login",
  );
  const navigationRef =
    useRef<NavigationContainerRef<RootStackParamList>>(null);

  // Initialize auth state from AsyncStorage on mount
  React.useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  // Navigate to pending deep link once authenticated
  React.useEffect(() => {
    if (isLoggedIn && pendingDeepLink && navigationRef.current) {
      const state = navigationRef.current.getState() as unknown;
      if (state != null) {
        // Avec ses paramètres : sans eux, « ouvrir la compétition » se réduisait
        // à « ouvrir un écran », ce qui ne veut rien dire pour CompetitionDetail.
        //
        // `dispatch(CommonActions.navigate(...))` plutôt que `navigate(a, b)` :
        // l'écran est une union de clés, et le typage de React Navigation ne
        // sait pas corréler la clé avec ses paramètres dans ce cas. L'action
        // explicite évite un double `as never` qui ne compile pas.
        navigationRef.current.dispatch(
          CommonActions.navigate({
            name: pendingDeepLink.screen,
            params: pendingDeepLink.params,
          }),
        );
        setPendingDeepLink(null);
      }
    }
  }, [isLoggedIn, pendingDeepLink, setPendingDeepLink]);

  // Show loading while auth state is being determined from AsyncStorage
  if (isLoggedIn === null) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: currentTheme.background,
        }}
      >
        <ActivityIndicator size="large" color={currentTheme.primary} />
      </View>
    );
  }

  const NavigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: currentTheme.background,
      card: currentTheme.surface,
      text: currentTheme.text,
      border: currentTheme.border,
      primary: currentTheme.primary,
    },
  };

  return (
    <NavigationContainer
      theme={NavigationTheme}
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        const routeName = navigationRef.current?.getCurrentRoute()?.name;
        setCurrentRouteName(routeName ?? undefined);
        if (routeName) {
          analytics.logScreenView(routeName);
        }
        try {
          logger.info(`Navigation State Change: ${currentRouteName}`);
        } catch {
          // Ignore logger errors during initialization
        }
      }}
      onStateChange={() => {
        const routeName = navigationRef.current?.getCurrentRoute()?.name;
        const previousRouteName = currentRouteName;

        if (previousRouteName !== routeName && routeName) {
          setCurrentRouteName(routeName);
          analytics.logScreenView(routeName);
          try {
            logger.info(`Navigation: ${previousRouteName} -> ${routeName}`);
          } catch {
            // Ignore logger errors during state change
          }
        }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: currentTheme.background },
          animation: "slide_from_right",
          gestureEnabled: true,
          animationDuration: 350,
        }}
      >
        {isLoggedIn ? (
          <>
            {/* App screens — only registered when authenticated */}
            <Stack.Screen name="Main" component={MainTabs} />

            {/* Competitions */}
            <Stack.Screen
              name="CompetitionDetail"
              component={CompetitionDetailScreen}
            />
            <Stack.Screen name="LiveResults" component={LiveResultsScreen} />
            <Stack.Screen
              name="VolunteerCheckin"
              component={VolunteerCheckinScreen}
              options={{ animation: "slide_from_bottom" }}
            />
            <Stack.Screen
              name="EventRegistrants"
              component={EventRegistrantsScreen}
            />

            {/* Club */}
            <Stack.Screen
              name="ClubDashboard"
              component={ClubDashboardScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="ClubCompetitions"
              component={ClubCompetitionsScreen}
            />
            <Stack.Screen
              name="ClubCompetitionEditor"
              component={ClubCompetitionFormScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen name="ClubMembers" component={ClubMembersScreen} />
            <Stack.Screen name="ClubCouples" component={ClubCouplesScreen} />
            <Stack.Screen
              name="ClubSoloTeams"
              component={ClubSoloTeamsScreen}
            />
            <Stack.Screen
              name="ClubSoloTeamDetail"
              component={ClubSoloTeamDetailScreen}
            />
            <Stack.Screen
              name="ClubMemberEditor"
              component={ClubMemberEditorScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen
              name="ClubRegistrations"
              component={ClubRegistrationsScreen}
            />

            {/* Player & Performance */}
            <Stack.Screen
              name="PerformanceSetup"
              component={PerformanceSetupScreen}
            />
            <Stack.Screen
              name="PerformancePlayer"
              component={PerformancePlayerScreen}
              options={{ animation: "fade" }}
            />
            <Stack.Screen
              name="AudioPlayer"
              component={AudioPlayerScreen}
              options={{
                presentation: "modal",
                gestureEnabled: true,
                gestureDirection: "vertical",
                ...Platform.select({
                  ios: {
                    presentation: "modal",
                  },
                }),
              }}
            />

            {/* Other */}
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
            />
            <Stack.Screen
              name="Scanner"
              component={ScannerScreen}
              options={{
                presentation: "fullScreenModal",
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="LicenseRenewal"
              component={LicenseRenewalScreen}
            />
            <Stack.Screen name="ViewCareer" component={ViewCareerScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
          </>
        ) : (
          <>
            {/* Auth screens — only registered when NOT authenticated */}
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
            />
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
            />
          </>
        )}
        {/* Documents légaux (#424) — accessibles connecté (Réglages) comme
            non connecté (lien CGU à l'inscription). */}
        <Stack.Screen name="Legal" component={LegalScreen} />
      </Stack.Navigator>
      {currentRouteName !== "PerformancePlayer" && (
        <MiniPlayer currentRouteName={currentRouteName} />
      )}
      {/* Acceptation CGU au premier lancement (#424) — autonome, ne rend
          rien si la version courante est déjà acceptée. */}
      <CguAcceptanceModal />
      {/* Bandeau hors-ligne global (#416) */}
      <OfflineBanner />
      {/* Bandeau permanent d'impersonation (#545) */}
      <ImpersonationBanner />
    </NavigationContainer>
  );
};
