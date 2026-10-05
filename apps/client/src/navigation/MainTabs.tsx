import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from "@react-navigation/bottom-tabs";
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  Award,
  IdCard,
  ListMusic,
  LucideIcon,
  Scan,
  Settings,
  Trophy,
  Users,
} from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useClubLogo } from "../stores/club.store";
import { useAuthStore } from "../stores/auth.store";
import { ThemeContextType, useTheme } from "../context/ThemeContext";
import { UserRole } from "../features/auth/services/AuthService";
import { CareerScreen } from "../features/career/screens/CareerScreen";
import { ClubDashboardScreen } from "../features/club/screens/ClubDashboardScreen";
import { CompetitionsScreen } from "../features/competitions/screens/CompetitionsScreen";
import { LibraryScreen } from "../features/player/screens/LibraryScreen";
import { LicenseScreen } from "../features/license/screens/LicenseScreen";
import { SettingsScreen } from "../features/settings/screens/SettingsScreen";
import {
  TabBarWithTransition,
  TabScreenComponent,
  TabTransitionContext,
  TabTransitionValue,
  withTabTransition,
} from "./tab-transition";
import { RootStackParamList, TabParamList } from "./types";

const Tab = createBottomTabNavigator<TabParamList>();

// Placeholder for Scanner Tab (redirects to Modal)
const ScannerTabPlaceholder = () => null;

// --- Icon Renderers ---

const getTabIcon =
  (IconComponent: LucideIcon, currentTheme: ThemeContextType["theme"]) =>
  ({
    color,
    focused,
    size,
  }: {
    color: string;
    focused: boolean;
    size: number;
  }) => (
    <IconComponent color={focused ? currentTheme.primary : color} size={size} />
  );

interface ClubTabIconProps {
  color: string;
  focused: boolean;
  size: number;
  clubLogoUri: string | null | undefined;
  currentTheme: ThemeContextType["theme"];
}

const ClubTabIcon = ({
  color,
  focused,
  size,
  clubLogoUri,
  currentTheme,
}: ClubTabIconProps) =>
  clubLogoUri ? (
    <View
      style={[
        styles.clubTabIconContainer,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Image
        source={{ uri: clubLogoUri }}
        style={{ width: size, height: size }}
        resizeMode="cover"
      />
    </View>
  ) : (
    getTabIcon(Users, currentTheme)({ color, focused, size })
  );

const styles = StyleSheet.create({
  clubTabIconContainer: {
    overflow: "hidden",
  },
});

// --- Wrapped tab screen components ---

const ClubDashboardScreenWithTransition = withTabTransition(
  ClubDashboardScreen,
) as unknown as TabScreenComponent;
const LicenseScreenWithTransition = withTabTransition(
  LicenseScreen,
) as unknown as TabScreenComponent;
const LibraryScreenWithTransition = withTabTransition(
  LibraryScreen,
) as unknown as TabScreenComponent;
const CareerScreenWithTransition = withTabTransition(
  CareerScreen,
) as unknown as TabScreenComponent;
const CompetitionsScreenWithTransition = withTabTransition(
  CompetitionsScreen,
) as unknown as TabScreenComponent;
const SettingsScreenWithTransition = withTabTransition(
  SettingsScreen,
) as unknown as TabScreenComponent;

// --- Main Tabs ---

type MainTabsProps = NativeStackScreenProps<RootStackParamList, "Main">;

export const MainTabs = ({ route }: MainTabsProps) => {
  const { theme: currentTheme } = useTheme();
  const { clubLogoUri } = useClubLogo();

  // Source of truth for role/guest is the auth store (hydrated from
  // AsyncStorage via refreshAuth). route.params is kept as a soft fallback
  // for older callers / tests, but AppNavigator no longer passes any params.
  const { role: storeRole, isGuest: storeIsGuest } = useAuthStore();
  const params = route.params ?? {};
  const isGuest = storeIsGuest || (params.isGuest ?? false);
  const role: UserRole =
    storeRole ??
    (params.role &&
    typeof params.role === "string" &&
    ["LICENSEE", "ADMIN", "GUEST", "CLUB", "STAFF"].includes(params.role)
      ? (params.role as UserRole)
      : isGuest
        ? "GUEST"
        : "LICENSEE");

  const lastIndexRef = useRef<number>(0);
  const [transition, setTransition] = useState<TabTransitionValue>({
    direction: 0,
    tick: 0,
  });

  const handleIndexChange = useCallback((nextIndex: number) => {
    const prevIndex = lastIndexRef.current;
    const direction =
      nextIndex === prevIndex ? 0 : nextIndex > prevIndex ? 1 : -1;
    lastIndexRef.current = nextIndex;
    setTransition((prev) => ({ direction, tick: prev.tick + 1 }));
  }, []);

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <TabBarWithTransition {...props} onIndexChange={handleIndexChange} />
    ),
    [handleIndexChange],
  );

  const renderClubTabIcon = useCallback(
    ({
      color,
      focused,
      size,
    }: {
      color: string;
      focused: boolean;
      size: number;
    }) => (
      <ClubTabIcon
        color={color}
        focused={focused}
        size={size}
        clubLogoUri={clubLogoUri}
        currentTheme={currentTheme}
      />
    ),
    [clubLogoUri, currentTheme],
  );

  return (
    <TabTransitionContext.Provider value={transition}>
      {/* key={role} : re-monte le navigateur quand le rôle change (switch de
          profil) pour reconstruire exactement le jeu d'onglets du nouveau rôle.
          Sans ça, React Navigation conserve l'état et laisse des onglets
          fantômes de l'ancien rôle. */}
      <Tab.Navigator
        key={`tabs-${role}${isGuest ? "-guest" : ""}`}
        tabBar={renderTabBar}
        screenOptions={{
          headerShown: false,
        }}
      >
        {role === "CLUB" && (
          <Tab.Screen
            name="ClubDashboard"
            component={ClubDashboardScreenWithTransition}
            options={{
              tabBarIcon: renderClubTabIcon,
              tabBarLabel: "Espace club",
              // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
              tabBarTestID: "tab-club",
            }}
          />
        )}

        {role === "LICENSEE" && (
          <Tab.Screen
            name="Career"
            component={CareerScreenWithTransition}
            options={{
              tabBarIcon: getTabIcon(Award, currentTheme),
              tabBarLabel: "Carrière",
              // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
              tabBarTestID: "tab-career",
            }}
          />
        )}

        {role === "LICENSEE" && (
          <Tab.Screen
            name="License"
            component={LicenseScreenWithTransition}
            options={{
              tabBarIcon: getTabIcon(IdCard, currentTheme),
              // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
              tabBarTestID: "tab-license",
            }}
          />
        )}

        {/* Bibliothèque musicale : le LICENCIÉ (danseur) pour s'entraîner et
            l'ADMIN pour modérer/ajouter. Pas pour club/staff/invité. */}
        {(role === "LICENSEE" || role === "ADMIN") && (
          <Tab.Screen
            name="Library"
            component={LibraryScreenWithTransition}
            options={{
              tabBarIcon: getTabIcon(ListMusic, currentTheme),
              tabBarLabel: "Bibliothèque",
              // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
              tabBarTestID: "tab-library",
            }}
          />
        )}

        <Tab.Screen
          name="Competitions"
          component={CompetitionsScreenWithTransition}
          options={{
            tabBarIcon: getTabIcon(Trophy, currentTheme),
            tabBarLabel: "Compétitions",
            // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
            tabBarTestID: "tab-competitions",
          }}
        />

        {(role === "STAFF" || role === "CLUB" || role === "ADMIN") && (
          <Tab.Screen
            name="ScannerTab"
            component={ScannerTabPlaceholder}
            listeners={({ navigation }) => ({
              tabPress: (e) => {
                e.preventDefault();
                navigation
                  .getParent<NativeStackNavigationProp<RootStackParamList>>()
                  .navigate("Scanner");
              },
            })}
            options={{
              tabBarIcon: getTabIcon(Scan, currentTheme),
              tabBarLabel: "Scanner",
              // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
              tabBarTestID: "tab-scanner",
            }}
          />
        )}

        <Tab.Screen
          name="Settings"
          component={SettingsScreenWithTransition}
          options={{
            tabBarIcon: getTabIcon(Settings, currentTheme),
            tabBarLabel: "Réglages",
            // @ts-expect-error: tabBarTestID is a custom property used by CurvedTabBar
            tabBarTestID: "tab-settings",
          }}
        />
      </Tab.Navigator>
    </TabTransitionContext.Provider>
  );
};
