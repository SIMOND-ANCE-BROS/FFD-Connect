import { NavigationContainer } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../context/ThemeContext";
import {
  AuthProvider,
  AuthRepository,
} from "../features/auth/context/AuthContext";
import { RootStackParamList } from "../navigation/types";

/**
 * Creates a typed mock of the React Navigation 'navigation' object.
 */
export function createMockNavigation(): NativeStackNavigationProp<RootStackParamList> {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn().mockReturnValue(jest.fn()),
    removeListener: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    canGoBack: jest.fn().mockReturnValue(true),
    getParent: jest.fn(),
    getState: jest.fn(),
    setParams: jest.fn(),
    emit: jest.fn().mockReturnValue({ defaultPrevented: false }),
    reset: jest.fn(),
  };

  return navigation as unknown as NativeStackNavigationProp<RootStackParamList>;
}

/**
 * Creates a typed mock of the React Navigation 'route' object.
 */
export function createMockRoute<T extends keyof RootStackParamList>(
  name: T,
  params: RootStackParamList[T],
) {
  return {
    key: `${name}-key`,
    name: name,
    params: params,
  };
}

/**
 * Creates typed props for a NativeStackScreen component.
 */
export function createMockScreenProps<T extends keyof RootStackParamList>(
  name: T,
  params: RootStackParamList[T],
) {
  return {
    navigation: createMockNavigation(),
    route: createMockRoute(name, params),
  };
}

// Mock Auth Repository for testing with all providers
const mockAuthRepository: AuthRepository = {
  getAuthConfig: jest.fn(),
  saveAuthConfig: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
  loginAsGuest: jest.fn(),
  logout: jest.fn(),
  setBiometricsEnabled: jest.fn(),
  setLicensePhoto: jest.fn(),
  setDefaultLibraryFilter: jest.fn(),
  setDefaultCompetitionScope: jest.fn(),
  setDefaultCompetitionStatus: jest.fn(),
  setAppTheme: jest.fn(),
  setAnimationsEnabled: jest.fn(),
  setDancerProfile: jest.fn(),
  setWdsfLicenseEnabled: jest.fn(),
  setRegistrationPolicy: jest.fn(),
  getProfile: jest.fn(),
  verifyWdsfLicense: jest.fn(),
  setClubLogo: jest.fn(),
  saveWdsfToBackend: jest.fn(),
  getClubDashboardConfig: jest.fn(),
  setClubDashboardConfig: jest.fn(),
};

/**
 * Renders a component wrapped in all providers (SafeArea, Theme, Auth, Navigation).
 */
export const renderWithProviders = async (ui: React.ReactElement) => {
  return await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider implementation={mockAuthRepository}>
          <NavigationContainer>{ui}</NavigationContainer>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
};

// Re-export testing library utilities
export { render, fireEvent, waitFor };
