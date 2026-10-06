import { act, renderHook } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { useBackendHealth } from "../../../../hooks/useBackendHealth";
import rnBiometrics from "../../../../utils/biometrics-adapter";
import { createMockNavigation } from "../../../../utils/testUtils";
import { useAuthRepository } from "../../../auth/context/AuthContext";
import { useSettingsLogic } from "../useSettingsLogic";

// Mock dependencies
jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

jest.mock("../../../../hooks/useBackendHealth", () => ({
  useBackendHealth: jest.fn(),
}));

jest.mock("../../../../utils/biometrics-adapter", () => ({
  __esModule: true,
  default: {
    isSensorAvailable: jest
      .fn()
      .mockResolvedValue({ available: false, biometryType: undefined }),
    simplePrompt: jest.fn().mockResolvedValue({ success: false }),
  },
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: "Images" },
}));

jest.mock("../../../club/services/ClubService", () => ({
  ClubService: {
    getHelloAssoStatus: jest.fn().mockResolvedValue({ registrationMode: null }),
    getMyClubRegistrationMode: jest
      .fn()
      .mockResolvedValue({ registrationMode: "MEMBERS_AUTO_CONFIRM" }),
  },
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));

// Mock the Zustand auth store
const mockRefreshAuth = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ refreshAuth: mockRefreshAuth }),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require("react") as typeof import("react");
    useEffect(cb, []);
  },
}));

const mockNavigation = createMockNavigation();

const mockAuth = {
  getAuthConfig: jest.fn(),
  setBiometricsEnabled: jest.fn(),
  logout: jest.fn(),
  setLicensePhoto: jest.fn(),
  setDefaultLibraryFilter: jest.fn(),
  setDefaultCompetitionScope: jest.fn(),
  setDefaultCompetitionStatus: jest.fn(),
  setRegistrationPolicy: jest.fn(),
};

const mockTheme = {
  theme: {},
  preference: "system",
  setPreference: jest.fn(),
  isDark: false,
  animationsEnabled: true,
  toggleAnimations: jest.fn(),
};

const mockBackendHealth = {
  checkHealth: jest.fn(),
};

describe("useSettingsLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Alert, "alert")
      .mockImplementation(
        (
          title?: string,
          _message?: string,
          buttons?: { text?: string; onPress?: () => void }[],
        ) => {
          // Find and call the last button's onPress if it's logout confirm
          if (title === "Déconnexion" && buttons?.[1]?.onPress) {
            buttons[1].onPress();
          }
          return undefined;
        },
      );

    (useAuthRepository as jest.Mock).mockReturnValue(mockAuth);
    (useTheme as jest.Mock).mockReturnValue(mockTheme);
    (useBackendHealth as jest.Mock).mockReturnValue(mockBackendHealth);

    mockAuth.getAuthConfig.mockResolvedValue({
      biometricsEnabled: false,
      licensePhotoUri: null,
      role: "LICENSEE",
    });
  });

  describe("Happy Path", () => {
    it("initializes and loads settings", async () => {
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        // useFocusEffect calls loadSettings and checkBiometryAvailability
      });

      expect(mockAuth.getAuthConfig).toHaveBeenCalled();

      expect(rnBiometrics.isSensorAvailable).toHaveBeenCalled();
      expect(result.current.state.role).toBe("LICENSEE");
    });

    it("toggles biometrics successfully", async () => {
      (rnBiometrics.simplePrompt as jest.Mock).mockResolvedValue({
        success: true,
      });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      // Wait for initial load to complete before acting
      await act(async () => {});

      await act(async () => {
        await result.current.actions.toggleBiometrics(true);
      });

      expect(result.current.state.biometricsEnabled).toBe(true);
      expect(mockAuth.setBiometricsEnabled).toHaveBeenCalledWith(true);
    });

    it("handles logout flow", async () => {
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await result.current.actions.handleLogout();
      });

      expect(Alert.alert).toHaveBeenCalled();
      expect(mockAuth.logout).toHaveBeenCalled();
      expect(mockRefreshAuth).toHaveBeenCalled();
    });

    it("tech info: shows real device/env/bundle info (not web-mock values)", async () => {
      mockBackendHealth.checkHealth.mockResolvedValue(true);
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        await result.current.actions.handleShowTechInfo();
      });

      const call = (Alert.alert as jest.Mock).mock.calls.find(
        ([title]) => title === "Informations techniques",
      );
      expect(call).toBeDefined();
      const body = call![1] as string;
      // Vrai appareil (mock jest = iPhone Test/18.0), pas les valeurs web
      expect(body).toContain("iPhone Test");
      expect(body).toContain("iOS 18.0");
      expect(body).not.toContain("Browser");
      expect(body).not.toContain("iOS Web");
      // Mêmes identifiants que TestFlight / Play (cf. utils/appIdentity)
      expect(body).toContain("FFD Connect 1.0.0 (85)");
      expect(body).toContain("Code : ");
      expect(body).toContain("Compatibilité OTA : ");
      // En test isEnabled=false → libellé dev explicite
      expect(body).toContain("Mise à jour : dev");
      expect(body).toContain("Backend : En ligne 🟢");
    });

    it("handles photo selection", async () => {
      (
        ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
      ).mockResolvedValue({ status: "granted" });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: "new-photo-uri" }],
      });

      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      // Wait for initial load to complete before acting
      await act(async () => {});

      await act(async () => {
        await result.current.actions.handleSelectPhoto();
      });

      expect(mockAuth.setLicensePhoto).toHaveBeenCalledWith("new-photo-uri");
      expect(result.current.state.photoUri).toBe("new-photo-uri");
    });

    it("updates library filter", async () => {
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      // Wait for initial load
      await act(async () => {});

      await act(async () => {
        await result.current.actions.handleSetLibraryFilter("style");
      });

      expect(result.current.state.defaultFilter).toBe("style");
      expect(mockAuth.setDefaultLibraryFilter).toHaveBeenCalledWith("style");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("handles biometric failure", async () => {
      (rnBiometrics.simplePrompt as jest.Mock).mockResolvedValue({
        success: false,
      });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        await result.current.actions.toggleBiometrics(true);
      });

      expect(result.current.state.biometricsEnabled).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Authentification échouée.",
      );
    });

    it("handles photo permission denied", async () => {
      (
        ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
      ).mockResolvedValue({ status: "denied" });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        await result.current.actions.handleSelectPhoto();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Permission requise",
        expect.any(String),
      );
      expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    });
  });
});
