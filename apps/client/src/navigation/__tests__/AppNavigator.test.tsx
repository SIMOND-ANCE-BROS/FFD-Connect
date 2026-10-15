import { render } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { useAuthRepository } from "../../features/auth/context/AuthContext";
import { useAuthReturnStore } from "../../stores/authReturn.store";
import { AppNavigator } from "../AppNavigator";
import { preloadReactNative } from "../../__tests__/mocks/preloadReactNative";

// Mock dependencies
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

// Standardized Inline ThemeContext Mock
jest.mock("../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../features/player/components/MiniPlayer", () => ({
  MiniPlayer: () => null,
  MINI_PLAYER_HEIGHT: 60,
}));

// Mock Auth Context
jest.mock("../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
  UserRole: {},
}));

// Mock the Zustand auth store — default to logged in so app screens render.
// Mutable (reset in beforeEach) so a test can play a guest or a signed-out
// session.
// NB : pas de `role` ici — le rôle des onglets est piloté par le mock
// useAuthRepository (params), MainTabs préfère storeRole ?? params.role.
const mockAuthState: {
  isLoggedIn: boolean | null;
  isGuest: boolean;
  impersonating: boolean;
  impersonatedName: string | null;
  refreshAuth: jest.Mock;
  pendingDeepLink: null;
  setPendingDeepLink: jest.Mock;
} = {
  isLoggedIn: true,
  isGuest: false,
  impersonating: false,
  impersonatedName: null,
  refreshAuth: jest.fn(),
  pendingDeepLink: null,
  setPendingDeepLink: jest.fn(),
};
jest.mock("../../stores/auth.store", () => ({
  useAuthStore: (selector?: (s: typeof mockAuthState) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
}));

// Navigation actions sent through the container ref.
const mockDispatch = jest.fn();

// Mock Screens individually with inline factories
jest.mock("../../features/auth/screens/LoginScreen", () => ({
  LoginScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Login">Login</Text>;
  },
}));
jest.mock("../../features/auth/screens/RegisterScreen", () => ({
  RegisterScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Register">Register</Text>;
  },
}));
jest.mock("../../features/license/screens/LicenseScreen", () => ({
  LicenseScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-License">License</Text>;
  },
}));
jest.mock("../../features/settings/screens/SettingsScreen", () => ({
  SettingsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Settings">Settings</Text>;
  },
}));
jest.mock("../../features/competitions/screens/CompetitionsScreen", () => ({
  CompetitionsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Competitions">Competitions</Text>;
  },
}));
jest.mock(
  "../../features/competitions/screens/CompetitionDetailScreen",
  () => ({
    CompetitionDetailScreen: () => {
      const { Text } = require("react-native");
      return <Text testID="screen-CompetitionDetail">CompetitionDetail</Text>;
    },
  }),
);
jest.mock("../../features/player/screens/LibraryScreen", () => ({
  LibraryScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Library">Library</Text>;
  },
}));
jest.mock("../../features/competitions/screens/LiveResultsScreen", () => ({
  LiveResultsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-LiveResults">LiveResults</Text>;
  },
}));
jest.mock("../../features/competitions/screens/EventRegistrantsScreen", () => ({
  EventRegistrantsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-EventRegistrants">EventRegistrants</Text>;
  },
}));
jest.mock("../../features/competitions/screens/SeatPickerScreen", () => ({
  SeatPickerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-SeatPicker">SeatPicker</Text>;
  },
}));
jest.mock("../../features/settings/screens/NotificationsScreen", () => ({
  NotificationsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Notifications">Notifications</Text>;
  },
}));
jest.mock(
  "../../features/track-corrections/screens/TrackCorrectionsReviewScreen",
  () => ({
    TrackCorrectionsReviewScreen: () => {
      const { Text } = require("react-native");
      return (
        <Text testID="screen-TrackCorrectionsReview">TrackCorrections</Text>
      );
    },
  }),
);
jest.mock(
  "../../features/track-corrections/screens/MyTrackCorrectionsScreen",
  () => ({
    MyTrackCorrectionsScreen: () => {
      const { Text } = require("react-native");
      return <Text testID="screen-MyTrackCorrections">MyTrackCorrections</Text>;
    },
  }),
);
jest.mock("../../features/performance/screens/PerformanceSetupScreen", () => ({
  PerformanceSetupScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-PerformanceSetup">PerformanceSetup</Text>;
  },
}));
jest.mock("../../features/performance/screens/PerformancePlayerScreen", () => ({
  PerformancePlayerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-PerformancePlayer">PerformancePlayer</Text>;
  },
}));
jest.mock("../../features/player/screens/AudioPlayerScreen", () => ({
  AudioPlayerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-AudioPlayer">AudioPlayer</Text>;
  },
}));
jest.mock("../../features/license/screens/ScannerScreen", () => ({
  ScannerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Scanner">Scanner</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubDashboardScreen", () => ({
  ClubDashboardScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubDashboard">ClubDashboard</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubCompetitionsScreen", () => ({
  ClubCompetitionsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubCompetitions">ClubCompetitions</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubCompetitionFormScreen", () => ({
  ClubCompetitionFormScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubCompetitionForm">ClubCompetitionForm</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubMembersScreen", () => ({
  ClubMembersScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubMembers">ClubMembers</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubMemberEditorScreen", () => ({
  ClubMemberEditorScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubMemberEditor">ClubMemberEditor</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubRefundsDueScreen", () => ({
  ClubRefundsDueScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubRefundsDue">ClubRefundsDue</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubRegistrationsScreen", () => ({
  ClubRegistrationsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubRegistrations">ClubRegistrations</Text>;
  },
}));
jest.mock("../../features/license/screens/LicenseRenewalScreen", () => ({
  LicenseRenewalScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-LicenseRenewal">LicenseRenewal</Text>;
  },
}));
jest.mock("../../features/parental-consent/ParentalConsentScreen", () => ({
  ParentalConsentScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ParentalConsent">ParentalConsent</Text>;
  },
}));
jest.mock("../../features/auth/screens/ForgotPasswordScreen", () => ({
  ForgotPasswordScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ForgotPassword">ForgotPassword</Text>;
  },
}));
jest.mock("../../features/auth/screens/ResetPasswordScreen", () => ({
  ResetPasswordScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ResetPassword">ResetPassword</Text>;
  },
}));
jest.mock("../../features/career/screens/CareerScreen", () => ({
  CareerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Career">Career</Text>;
  },
}));
jest.mock("../../features/career/screens/ViewCareerScreen", () => ({
  ViewCareerScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ViewCareer">ViewCareer</Text>;
  },
}));
// ProfileScreen fires real network calls (api.get("/career/me") + "/licenses/my")
// from a mount effect. Left unmocked, those floating promises + their retry
// timers resolve in a LATER Jest suite (after MSW handlers are reset), where
// the response body is undefined and ProfileScreen's setResults() throws
// "Cannot read properties of undefined (reading 'results')". Stub it like every
// other screen so the navigator test stays isolated. See jest.msw-setup.js.
jest.mock("../../features/profile/screens/ProfileScreen", () => ({
  ProfileScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-Profile">Profile</Text>;
  },
}));
jest.mock("../../features/competitions/screens/VolunteerCheckinScreen", () => ({
  VolunteerCheckinScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-VolunteerCheckin">VolunteerCheckin</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubCouplesScreen", () => ({
  ClubCouplesScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubCouples">ClubCouples</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubSoloTeamDetailScreen", () => ({
  ClubSoloTeamDetailScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubSoloTeamDetail">ClubSoloTeamDetail</Text>;
  },
}));
jest.mock("../../features/club/screens/ClubSoloTeamsScreen", () => ({
  ClubSoloTeamsScreen: () => {
    const { Text } = require("react-native");
    return <Text testID="screen-ClubSoloTeams">ClubSoloTeams</Text>;
  },
}));

jest.mock("../../components/CurvedTabBar", () => ({
  CurvedTabBar: () => null,
}));

// Mock React Navigation - Complete Replacement
jest.mock("@react-navigation/native", () => {
  const ReactMock = require("react");
  return {
    CommonActions: {
      navigate: (payload: unknown) => ({ type: "NAVIGATE", payload }),
    },
    NavigationContainer: ({
      children,
      onReady,
      onStateChange,
      ref,
    }: {
      children: React.ReactNode;
      onReady?: () => void;
      onStateChange?: () => void;
      ref?: React.Ref<unknown>;
    }) => {
      ReactMock.useImperativeHandle(ref, () => ({
        getState: () => ({ routes: [] }),
        getCurrentRoute: () => undefined,
        dispatch: mockDispatch,
      }));
      ReactMock.useEffect(() => {
        if (onReady) onReady();
      }, [onReady]);
      ReactMock.useEffect(() => {
        if (onStateChange) onStateChange();
      }, [onStateChange]);
      return <>{children}</>;
    },
    useNavigation: () => ({
      navigate: jest.fn(),
      emit: jest.fn(() => ({ defaultPrevented: false })),
    }),
    useIsFocused: () => true,
    useRoute: () => ({ params: {} }),
    DarkTheme: { colors: { background: "#000" } },
    DefaultTheme: { colors: { background: "#fff" } },
    createContext: ReactMock.createContext,
  };
});

jest.mock("@react-navigation/native-stack", () => {
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) => children,
      Screen: ({
        component: Component,
        children,
        name,
      }: {
        component?: React.ComponentType<{
          route: Record<string, unknown>;
          navigation: Record<string, unknown>;
        }>;
        children?: React.ReactNode;
        name: string;
      }) => {
        // Intercept Main screen to pass role from mock auth repository
        const authContext =
          require("../../features/auth/context/AuthContext") as {
            useAuthRepository: () => { user?: { role?: string } };
          };
        const auth = authContext.useAuthRepository();
        const role = auth.user?.role ?? "LICENSEE";
        const params = name === "Main" ? { role } : {};

        if (Component)
          return (
            <Component
              route={{ params }}
              navigation={{ navigate: jest.fn() }}
            />
          );
        return <>{children}</>;
      },
    }),
  };
});

jest.mock("@react-navigation/bottom-tabs", () => {
  const { View } = require("react-native");
  return {
    createBottomTabNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) => children,
      Screen: ({
        component: Component,
        children,
        name,
      }: {
        component?: React.ComponentType<{
          route: Record<string, unknown>;
          navigation: Record<string, unknown>;
        }>;
        children?: React.ReactNode;
        name: string;
      }) => {
        const content = Component ? (
          <Component
            route={{ params: {} }}
            navigation={{ navigate: jest.fn() }}
          />
        ) : (
          children
        );
        return <View testID={`tab-screen-${name}`}>{content}</View>;
      },
    }),
  };
});

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("ScrollView", "Modal", "Text");

describe("AppNavigator", () => {
  const mockTheme = {
    theme: {
      background: "#ffffff",
      surface: "#ffffff",
      text: "#000000",
      border: "#dddddd",
      primary: "#0000ff",
    },
    isDark: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.isLoggedIn = true;
    mockAuthState.isGuest = false;
    useAuthReturnStore.setState({ target: null });
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
  });

  it("renders correctly for LICENSEE role", async () => {
    (useAuthRepository as jest.Mock).mockReturnValue({
      user: { id: "1", role: "LICENSEE" },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = await render(<AppNavigator />);

    expect(getByTestId("tab-screen-Career")).toBeTruthy();
    expect(getByTestId("tab-screen-License")).toBeTruthy();
    expect(getByTestId("tab-screen-Library")).toBeTruthy();
    expect(getByTestId("tab-screen-Competitions")).toBeTruthy();
    expect(getByTestId("tab-screen-Settings")).toBeTruthy();

    expect(queryByTestId("tab-screen-ScannerTab")).toBeNull();
    expect(queryByTestId("tab-screen-ClubDashboard")).toBeNull();
  });

  it("renders correctly for CLUB role", async () => {
    (useAuthRepository as jest.Mock).mockReturnValue({
      user: { id: "2", role: "CLUB" },
      isLoading: false,
    });

    // We need to render AppNavigator. Since our mock of Stack.Navigator
    // passes empty params by default, we need a way to inject them.
    // I'll update the Stack.Screen mock in the test file once more to
    // use the component's role if available from a global mock state.

    const { getByTestId, queryByTestId } = await render(<AppNavigator />);

    // With 'CLUB' role, we expect:
    expect(getByTestId("tab-screen-ScannerTab")).toBeTruthy();
    expect(getByTestId("tab-screen-ClubDashboard")).toBeTruthy();
    expect(getByTestId("tab-screen-Competitions")).toBeTruthy();
    expect(getByTestId("tab-screen-Settings")).toBeTruthy();

    // Carrière = danseur, Bibliothèque = danseur/admin → pas pour le club
    expect(queryByTestId("tab-screen-Career")).toBeNull();
    expect(queryByTestId("tab-screen-License")).toBeNull();
    expect(queryByTestId("tab-screen-Library")).toBeNull();
  });

  it("renders correctly for STAFF role", async () => {
    (useAuthRepository as jest.Mock).mockReturnValue({
      user: { id: "3", role: "STAFF" },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = await render(<AppNavigator />);

    expect(getByTestId("tab-screen-ScannerTab")).toBeTruthy();
    expect(getByTestId("tab-screen-Competitions")).toBeTruthy();
    expect(queryByTestId("tab-screen-ClubDashboard")).toBeNull();
    // Staff : ni Carrière, ni Licence, ni Bibliothèque
    expect(queryByTestId("tab-screen-Career")).toBeNull();
    expect(queryByTestId("tab-screen-License")).toBeNull();
    expect(queryByTestId("tab-screen-Library")).toBeNull();
  });

  it("renders correctly for ADMIN role", async () => {
    (useAuthRepository as jest.Mock).mockReturnValue({
      user: { id: "5", role: "ADMIN" },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = await render(<AppNavigator />);

    // Admin : bibliothèque (modération) + scanner + compétitions ; rien du danseur/club
    expect(getByTestId("tab-screen-Library")).toBeTruthy();
    expect(getByTestId("tab-screen-ScannerTab")).toBeTruthy();
    expect(getByTestId("tab-screen-Competitions")).toBeTruthy();
    expect(queryByTestId("tab-screen-Career")).toBeNull();
    expect(queryByTestId("tab-screen-License")).toBeNull();
    expect(queryByTestId("tab-screen-ClubDashboard")).toBeNull();
  });

  it("renders correctly for GUEST role", async () => {
    (useAuthRepository as jest.Mock).mockReturnValue({
      user: { id: "4", role: "GUEST" },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = await render(<AppNavigator />);

    expect(getByTestId("tab-screen-Competitions")).toBeTruthy();
    expect(getByTestId("tab-screen-Settings")).toBeTruthy();
    expect(queryByTestId("tab-screen-License")).toBeNull();
    expect(queryByTestId("tab-screen-Library")).toBeNull();
  });

  describe("return after a guest signs in (#20)", () => {
    const target = {
      screen: "CompetitionDetail" as const,
      params: { competitionId: "comp-1" },
    };

    beforeEach(() => {
      (useAuthRepository as jest.Mock).mockReturnValue({
        user: { id: "1", role: "LICENSEE" },
        isLoading: false,
      });
    });

    it("keeps the target while Login is shown", async () => {
      mockAuthState.isLoggedIn = false;
      useAuthReturnStore.getState().setTarget(target);

      const { getByTestId } = await render(<AppNavigator />);

      expect(getByTestId("screen-Login")).toBeTruthy();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(useAuthReturnStore.getState().target).toEqual(target);
    });

    it("reopens the competition once signed in, then forgets it", async () => {
      mockAuthState.isLoggedIn = false;
      useAuthReturnStore.getState().setTarget(target);
      const view = await render(<AppNavigator />);

      // Login or registration succeeded: refreshAuth flips the session.
      mockAuthState.isLoggedIn = true;
      await view.rerender(<AppNavigator />);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "NAVIGATE",
        payload: { name: "CompetitionDetail", params: target.params },
      });
      expect(useAuthReturnStore.getState().target).toBeNull();
    });

    it("drops the target when the user goes back to guest mode", async () => {
      mockAuthState.isLoggedIn = true;
      mockAuthState.isGuest = true;
      useAuthReturnStore.getState().setTarget(target);

      await render(<AppNavigator />);

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(useAuthReturnStore.getState().target).toBeNull();
    });

    it("does nothing without a pending target", async () => {
      await render(<AppNavigator />);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
