import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import React from "react";
import { Alert } from "react-native";
import { BackendService } from "../../../../services/BackendService";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { SettingsScreen } from "../SettingsScreen";

// Cloche de notifs = React Query → hors périmètre de ce test (testée à part).
jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    checkHealth: jest.fn(),
  },
}));

type MockAuthContext = {
  getAuthConfig: jest.Mock;
  setDefaultLibraryFilter: jest.Mock;
  setDefaultCompetitionScope: jest.Mock;
  setDefaultCompetitionStatus: jest.Mock;
  setRegistrationPolicy: jest.Mock;
  setBiometricsEnabled: jest.Mock;
  setLicensePhoto: jest.Mock;
  logout: jest.Mock;
};
type MockThemeContext = {
  theme: Record<string, string | boolean>;
  preference: string;
  setPreference: jest.Mock;
  isDark: boolean;
  animationsEnabled: boolean;
  toggleAnimations: jest.Mock;
};
const mockAuthStore: { current: MockAuthContext } = {
  current: {} as unknown as MockAuthContext,
};
const mockThemeStore: { current: MockThemeContext } = {
  current: {} as unknown as MockThemeContext,
};
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => mockThemeStore.current,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  ThemePreference: {},
}));
const mockBackendHealth = { checkHealth: jest.fn().mockResolvedValue(true) };
jest.mock("../../../../hooks/useBackendHealth", () => ({
  useBackendHealth: () => ({
    isOnline: true,
    lastCheck: null,
    checkHealth: mockBackendHealth.checkHealth,
  }),
}));
jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: () => mockAuthStore.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../../utils/biometrics-adapter", () => ({
  __esModule: true,
  default: {
    isSensorAvailable: jest.fn(),
    simplePrompt: jest.fn(),
  },
  BiometryTypes: { FaceID: "FaceID", TouchID: "TouchID" },
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: "granted" }),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: {
    Images: "images",
  },
}));

jest.mock("expo-device", () => ({
  osVersion: "1.0.0",
  osBuildId: "1",
}));

import type {
  MockFluidSegmentedTabProps,
  MockIconProps,
  MockTextProps,
  MockViewProps,
} from "../../../../__tests__/mocks/types";
import biometricsAdapter from "../../../../utils/biometrics-adapter";

jest.mock("lucide-react-native", () => {
  const { View } = require("react-native");
  const MockIcon = (props: MockIconProps) =>
    require("react").createElement(View, props);
  return {
    AlertTriangle: MockIcon,
    Camera: MockIcon,
    ChevronRight: MockIcon,
    Download: MockIcon,
    FileText: MockIcon,
    Trash2: MockIcon,
    CreditCard: MockIcon,
    IdCard: MockIcon,
    Info: MockIcon,
    LogIn: MockIcon,
    ListMusic: MockIcon,
    LogOut: MockIcon,
    MessageSquare: MockIcon,
    Moon: MockIcon,
    Shield: MockIcon,
    Trophy: MockIcon,
    User: MockIcon,
    Users: MockIcon,
    Zap: MockIcon,
    Key: MockIcon,
  };
});

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: (props: MockViewProps) =>
      require("react").createElement(View, props),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock("../../../../components/AppText");
jest.mock("../../../../components/FluidSegmentedTab", () => {
  const { View, TouchableOpacity } = require("react-native");
  return {
    FluidSegmentedTab: ({
      onChange,
      options,
      testID,
    }: MockFluidSegmentedTabProps) =>
      require("react").createElement(
        View,
        { testID },
        options.map((opt) =>
          require("react").createElement(TouchableOpacity, {
            key: opt.value,
            testID: `${testID}-${opt.value}`,
            onPress: () => onChange(opt.value),
          }),
        ),
      ),
  };
});

// The section queries React Query (admin badge); its own suite covers that.
jest.mock(
  "../../../track-corrections/components/TrackCorrectionsSettingsSection",
  () => {
    const { Text, TouchableOpacity } = require("react-native");
    const ReactMock = require("react");
    return {
      TrackCorrectionsSettingsSection: ({
        onOpenMine,
        onOpenReview,
      }: {
        onOpenMine: () => void;
        onOpenReview: () => void;
      }) =>
        ReactMock.createElement(
          ReactMock.Fragment,
          null,
          ReactMock.createElement(
            TouchableOpacity,
            { testID: "mock-open-mine", onPress: onOpenMine },
            ReactMock.createElement(Text, null, "mine"),
          ),
          ReactMock.createElement(
            TouchableOpacity,
            { testID: "mock-open-review", onPress: onOpenReview },
            ReactMock.createElement(Text, null, "review"),
          ),
        ),
    };
  },
);

jest.mock("../../../competitions/components/ReportModal", () => {
  const { View } = require("react-native");
  return {
    ReportModal: () =>
      require("react").createElement(View, { testID: "report-modal-mock" }),
  };
});

jest.mock("../../components/ChangePasswordModal", () => {
  const { View } = require("react-native");
  return {
    ChangePasswordModal: () =>
      require("react").createElement(View, {
        testID: "change-password-modal-mock",
      }),
  };
});

// La modale importe PrivacyService (SDK généré + expo-sharing) — mock léger.
jest.mock("../../components/DeleteAccountModal", () => {
  const { View } = require("react-native");
  return {
    DeleteAccountModal: () =>
      require("react").createElement(View, {
        testID: "delete-account-modal-mock",
      }),
  };
});

jest.mock("../../services/PrivacyService", () => ({
  exportAndShareMyData: jest.fn().mockResolvedValue(undefined),
  deleteMyAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../components/HelloAssoModal", () => {
  const { View } = require("react-native");
  return {
    HelloAssoModal: () =>
      require("react").createElement(View, {
        testID: "hello-asso-modal-mock",
      }),
  };
});

// Mock the Zustand auth store for logout flow
const mockRefreshAuth = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ refreshAuth: mockRefreshAuth }),
}));

jest.mock("../../../../stores/club.store", () => ({
  useClubLogo: jest.fn(() => ({ clubLogoUri: null, setClubLogo: jest.fn() })),
  useClubStore: Object.assign(
    jest.fn((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ repository: {} }),
    ),
    {
      getState: jest.fn(() => ({
        setRepository: jest.fn(),
        setClubLogoUri: jest.fn(),
      })),
    },
  ),
  useClubRepository: jest.fn(() => ({})),
}));

jest.mock("../../../club/services/ClubService", () => ({
  ClubService: {
    getHelloAssoStatus: jest.fn().mockResolvedValue({ registrationMode: null }),
    getMembers: jest.fn().mockResolvedValue([]),
    getMyClubRegistrationMode: jest
      .fn()
      .mockResolvedValue({ registrationMode: "MEMBERS_AUTO_CONFIRM" }),
  },
}));

jest.mock("@react-navigation/native", () => {
  const R = require("react");
  return {
    useFocusEffect: (callback: () => void) => {
      const savedCallback = R.useRef(callback);
      savedCallback.current = callback;
      R.useEffect(() => {
        savedCallback.current();
      }, []);
    },
  };
});

mockThemeStore.current = {
  theme: {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
    dark: false,
  },
  preference: "system",
  setPreference: jest.fn().mockResolvedValue(undefined),
  isDark: false,
  animationsEnabled: true,
  toggleAnimations: jest.fn().mockResolvedValue(undefined),
};
mockAuthStore.current = {
  getAuthConfig: jest.fn().mockResolvedValue({
    role: "LICENSEE",
    defaultLibraryFilter: "default",
    defaultCompetitionScope: "all",
    defaultCompetitionStatus: "UPCOMING",
    biometricsEnabled: false,
    licensePhotoUri: "path/to/photo",
  }),
  setDefaultLibraryFilter: jest.fn(),
  setDefaultCompetitionScope: jest.fn(),
  setDefaultCompetitionStatus: jest.fn(),
  setRegistrationPolicy: jest.fn(),
  setBiometricsEnabled: jest.fn(),
  setLicensePhoto: jest.fn(),
  logout: jest.fn(),
};

const createTestProps = () => createMockScreenProps("Settings", undefined);

describe("SettingsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshAuth.mockClear();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (BackendService.checkHealth as jest.Mock).mockResolvedValue(true);
    // Reset defaults for mockAuth and mockThemeContext
    mockAuthStore.current.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      defaultLibraryFilter: "default",
      defaultCompetitionScope: "all",
      defaultCompetitionStatus: "UPCOMING",
      biometricsEnabled: false,
      licensePhotoUri: "path/to/photo",
    });
    (biometricsAdapter.isSensorAvailable as jest.Mock).mockResolvedValue({
      available: true,
      biometryType: "FaceID",
    });
    (biometricsAdapter.simplePrompt as jest.Mock).mockResolvedValue({
      success: true,
    });
  });

  it("renders correctly and loads data", async () => {
    const props = createTestProps();
    const { getByText } = await render(<SettingsScreen {...props} />);

    await waitFor(() => {
      expect(getByText("Réglages")).toBeTruthy();
      expect(mockAuthStore.current.getAuthConfig).toHaveBeenCalled();
    });
  });

  it("opens the track correction screens from the Musiques section", async () => {
    const props = createTestProps();
    const { findByTestId, getByTestId } = await render(
      <SettingsScreen {...props} />,
    );

    await fireEvent.press(await findByTestId("mock-open-mine"));
    expect(props.navigation.navigate).toHaveBeenCalledWith(
      "MyTrackCorrections",
    );
    await fireEvent.press(getByTestId("mock-open-review"));
    expect(props.navigation.navigate).toHaveBeenCalledWith(
      "TrackCorrectionsReview",
    );
  });

  it("handles logout flow", async () => {
    const props = createTestProps();
    const { getByTestId } = await render(<SettingsScreen {...props} />);
    await waitFor(() =>
      expect(getByTestId("settings-logout-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("settings-logout-button"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Déconnexion",
      "Voulez-vous vraiment vous déconnecter ?",
      expect.any(Array),
    );

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const logoutAction = alertCalls[0][2][1];
    await act(async () => {
      await logoutAction.onPress();
    });

    expect(mockAuthStore.current.logout).toHaveBeenCalled();
    // Auth state refresh triggers navigator swap to AuthStack
    expect(mockRefreshAuth).toHaveBeenCalled();
  });

  it("updates theme preference", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-theme-segmented")).toBeTruthy(),
    );

    await act(async () => {
      await fireEvent(
        getByTestId("settings-theme-segmented"),
        "onChange",
        "dark",
      );
    });

    expect(mockThemeStore.current.setPreference).toHaveBeenCalledWith("dark");
  });

  it("toggles animations", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-animations-switch")).toBeTruthy(),
    );

    await fireEvent(
      getByTestId("settings-animations-switch"),
      "onValueChange",
      false,
    );
    expect(mockThemeStore.current.toggleAnimations).toHaveBeenCalled();
  });

  it("shows tech info with backend status", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-tech-info-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("settings-tech-info-button"));

    await waitFor(() => {
      expect(mockBackendHealth.checkHealth).toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Informations techniques",
        expect.stringContaining("En ligne 🟢"),
        expect.any(Array),
      );
    });
  });

  it("updates competition filters", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-competition-scope-tab")).toBeTruthy(),
    );

    await fireEvent(
      getByTestId("settings-competition-scope-tab"),
      "onChange",
      "registrant",
    );
    await waitFor(() => {
      expect(
        mockAuthStore.current.setDefaultCompetitionScope,
      ).toHaveBeenCalledWith("registrant");
    });

    await fireEvent(
      getByTestId("settings-competition-status-tab"),
      "onChange",
      "LIVE",
    );
    await waitFor(() => {
      expect(
        mockAuthStore.current.setDefaultCompetitionStatus,
      ).toHaveBeenCalledWith("LIVE");
    });
  });

  it("updates library filters", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-library-filter-tab")).toBeTruthy(),
    );

    const tabLink = getByTestId("settings-library-filter-tab-likes");
    await fireEvent.press(tabLink);

    await waitFor(() => {
      expect(
        mockAuthStore.current.setDefaultLibraryFilter,
      ).toHaveBeenCalledWith("likes");
    });
  });

  describe("Organizer specific tests", () => {
    it("shows registration policy for organizer", async () => {
      mockAuthStore.current.getAuthConfig.mockResolvedValue({
        role: "CLUB",
        registrationPolicy: "MEMBER_VALIDATION",
      });

      const { getByTestId } = await render(
        <SettingsScreen {...createTestProps()} />,
      );

      await waitFor(
        () => expect(getByTestId("settings-reg-policy-CLUB_ONLY")).toBeTruthy(),
        { timeout: 5000 },
      );

      await fireEvent.press(getByTestId("settings-reg-policy-CLUB_ONLY"));
      await waitFor(() => {
        expect(
          mockAuthStore.current.setRegistrationPolicy,
        ).toHaveBeenCalledWith("CLUB_ONLY");
      });
    });
  });

  it("opens report bug modal", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-report-bug-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("settings-report-bug-button"));
  });

  it("handles biometrics toggle success", async () => {
    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );

    await waitFor(() =>
      expect(getByTestId("settings-biometrics-switch")).toBeTruthy(),
    );

    await fireEvent(
      getByTestId("settings-biometrics-switch"),
      "onValueChange",
      true,
    );

    await waitFor(() => {
      expect(biometricsAdapter.simplePrompt).toHaveBeenCalled();
      expect(mockAuthStore.current.setBiometricsEnabled).toHaveBeenCalledWith(
        true,
      );
    });
  });

  it("handles biometrics toggle failure", async () => {
    (biometricsAdapter.simplePrompt as jest.Mock).mockResolvedValueOnce({
      success: false,
    });

    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-biometrics-switch")).toBeTruthy(),
    );

    await fireEvent(
      getByTestId("settings-biometrics-switch"),
      "onValueChange",
      true,
    );

    await waitFor(() => {
      expect(biometricsAdapter.simplePrompt).toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Authentification échouée.",
      );
    });
  });

  it("handles image picker successfully", async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "new/pht" }],
    });

    const { getByTestId } = await render(
      <SettingsScreen {...createTestProps()} />,
    );
    await waitFor(() =>
      expect(getByTestId("settings-avatar-button")).toBeTruthy(),
    );

    await fireEvent.press(getByTestId("settings-avatar-button"));

    await waitFor(() => {
      expect(mockAuthStore.current.setLicensePhoto).toHaveBeenCalledWith(
        "new/pht",
      );
      expect(Alert.alert).toHaveBeenCalledWith("Succès", "Photo mise à jour.");
    });
  });
});
