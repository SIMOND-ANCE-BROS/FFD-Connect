import { act, renderHook } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { useBackendHealth } from "../../../../hooks/useBackendHealth";
import {
  PaymentProviderApi,
  PaymentProviderApiError,
} from "../../../../services/api/payment-provider-api";
import rnBiometrics from "../../../../utils/biometrics-adapter";
import { createMockNavigation } from "../../../../utils/testUtils";
import { useAuthRepository } from "../../../auth/context/AuthContext";
import { ClubService } from "../../../club/services/ClubService";
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

jest.mock("../../../../services/api/payment-provider-api", () => ({
  ...jest.requireActual("../../../../services/api/payment-provider-api"),
  PaymentProviderApi: {
    getStatus: jest.fn().mockResolvedValue(null),
    setProvider: jest.fn(),
  },
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
  getProfile: jest.fn(),
  syncRolesFromProfile: jest.fn(),
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

  // #665: the club setting is read from its own route, never from the
  // HelloAsso status (whose field is deprecated).
  describe("club registration mode", () => {
    // clearAllMocks keeps implementations: restore the module defaults.
    afterEach(() => {
      (ClubService.getHelloAssoStatus as jest.Mock).mockResolvedValue({
        registrationMode: null,
      });
      (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
        registrationMode: "MEMBERS_AUTO_CONFIRM",
      });
    });

    const render = async () => {
      const hook = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      return hook;
    };

    it.each([
      ["CLUB_AND_MEMBERS_PENDING", "MEMBER_VALIDATION"],
      ["CLUB_ONLY", "CLUB_ONLY"],
      ["MEMBERS_AUTO_CONFIRM", "MEMBER_AUTO"],
    ])(
      "maps the club's %s from GET /clubs/me/registration-mode",
      async (mode, policy) => {
        mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
        (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
          registrationMode: mode,
        });
        const { result } = await render();
        expect(ClubService.getMyClubRegistrationMode).toHaveBeenCalled();
        expect(result.current.state.registrationPolicy).toBe(policy);
      },
    );

    it("ignores the deprecated field of the HelloAsso status", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      (ClubService.getHelloAssoStatus as jest.Mock).mockResolvedValue({
        clubName: "Club Test",
        helloAssoConnected: false,
        organizationSlug: null,
        registrationMode: "CLUB_ONLY",
      });
      (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
        registrationMode: "MEMBERS_AUTO_CONFIRM",
      });
      const { result } = await render();
      expect(result.current.state.registrationPolicy).toBe("MEMBER_AUTO");
    });

    it("keeps the local policy when the account has no club", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        role: "ADMIN",
        registrationPolicy: "CLUB_ONLY",
      });
      (ClubService.getMyClubRegistrationMode as jest.Mock).mockResolvedValue({
        registrationMode: null,
      });
      const { result } = await render();
      expect(result.current.state.registrationPolicy).toBe("CLUB_ONLY");
    });

    it("keeps the local policy and the HelloAsso status when the mode fails to load", async () => {
      const helloAsso = {
        clubName: "Club Test",
        helloAssoConnected: true,
        organizationSlug: "club-test",
      };
      mockAuth.getAuthConfig.mockResolvedValue({
        role: "CLUB",
        registrationPolicy: "MEMBER_AUTO",
      });
      (ClubService.getHelloAssoStatus as jest.Mock).mockResolvedValue(
        helloAsso,
      );
      (ClubService.getMyClubRegistrationMode as jest.Mock).mockRejectedValue(
        new Error("offline"),
      );
      const { result } = await render();
      expect(result.current.state.registrationPolicy).toBe("MEMBER_AUTO");
      expect(result.current.state.helloAssoStatus).toEqual(helloAsso);
    });

    it("does not load the club setting for a licensee", async () => {
      await render();
      expect(ClubService.getMyClubRegistrationMode).not.toHaveBeenCalled();
    });
  });

  describe("role sync from the profile (no re-login)", () => {
    it("applies the fetched profile's roles, then refreshes the session", async () => {
      const profile = {
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE", "CLUB"],
      };
      mockAuth.getProfile.mockResolvedValue(profile);
      mockAuth.syncRolesFromProfile.mockResolvedValue({
        role: "LICENSEE",
        roles: ["LICENSEE", "CLUB"],
      });

      await renderHook(() => useSettingsLogic({ navigation: mockNavigation }));
      await act(async () => {});

      expect(mockAuth.getProfile).toHaveBeenCalledTimes(1);
      expect(mockAuth.syncRolesFromProfile).toHaveBeenCalledWith(profile);
      expect(mockRefreshAuth).toHaveBeenCalled();
    });

    it("shows the space the sync fell back to", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      mockAuth.getProfile.mockResolvedValue({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE"],
      });
      mockAuth.syncRolesFromProfile.mockResolvedValue({
        role: "LICENSEE",
        roles: ["LICENSEE"],
      });

      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});

      expect(result.current.state.role).toBe("LICENSEE");
    });

    it("does not refresh the session when the profile cannot be loaded", async () => {
      mockAuth.getProfile.mockRejectedValue(new Error("offline"));

      await renderHook(() => useSettingsLogic({ navigation: mockNavigation }));
      await act(async () => {});

      expect(mockAuth.syncRolesFromProfile).not.toHaveBeenCalled();
      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });
  });

  describe("license expiry reminder (#255)", () => {
    // End of August 31 in Paris, as the backend stores it (#238).
    const validUntil = "2027-08-31T21:59:59.999Z";

    afterEach(() => {
      jest.useRealTimers();
      mockAuth.getProfile.mockReset();
      mockAuth.syncRolesFromProfile.mockReset();
    });

    const daysAt = async (
      now: string,
      license: { validUntil?: string } | null = { validUntil },
    ): Promise<number | null> => {
      // Fake the clock only: promises and timers keep running for real.
      jest.useFakeTimers({
        now: new Date(now),
        doNotFake: [
          "nextTick",
          "queueMicrotask",
          "setImmediate",
          "clearImmediate",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "requestIdleCallback",
          "cancelIdleCallback",
          "hrtime",
          "performance",
        ],
      });
      mockAuth.getProfile.mockResolvedValue({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE"],
        license,
      });
      mockAuth.syncRolesFromProfile.mockResolvedValue({ role: "LICENSEE" });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      return result.current.state.licenseExpiryDays;
    };

    it("says 'today' (0 days) on the last day, like the License screen", async () => {
      expect(await daysAt("2027-08-31T10:00:00Z")).toBe(0);
    });

    it("counts Paris calendar days before the end", async () => {
      expect(await daysAt("2027-08-30T21:30:00Z")).toBe(1);
      expect(await daysAt("2027-08-11T10:00:00Z")).toBe(20);
    });

    it("shows no reminder once the license has expired", async () => {
      expect(await daysAt("2027-08-31T22:01:00Z")).toBeNull();
      expect(await daysAt("2027-09-01T10:00:00Z")).toBeNull();
    });

    it("shows no reminder more than 30 days ahead or without an end date", async () => {
      expect(await daysAt("2027-06-01T10:00:00Z")).toBeNull();
      expect(await daysAt("2027-08-31T10:00:00Z", null)).toBeNull();
    });
  });

  describe("store-review flag from the profile", () => {
    // Keep the later suites on the default (unresolved) profile.
    afterEach(() => {
      mockAuth.getProfile.mockReset();
      mockAuth.syncRolesFromProfile.mockReset();
    });

    it("is unknown until the profile loads", async () => {
      mockAuth.getProfile.mockRejectedValue(new Error("offline"));
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      expect(result.current.state.isStoreReview).toBeNull();
    });

    it("exposes the store-review account", async () => {
      mockAuth.getProfile.mockResolvedValue({
        email: "r@x.fr",
        role: "ADMIN",
        roles: ["ADMIN"],
        isStoreReview: true,
      });
      mockAuth.syncRolesFromProfile.mockResolvedValue({ role: "ADMIN" });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      expect(result.current.state.isStoreReview).toBe(true);
    });

    it("treats a profile without the flag (older backend) as a regular account", async () => {
      mockAuth.getProfile.mockResolvedValue({
        email: "a@x.fr",
        role: "ADMIN",
        roles: ["ADMIN"],
      });
      mockAuth.syncRolesFromProfile.mockResolvedValue({ role: "ADMIN" });
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      expect(result.current.state.isStoreReview).toBe(false);
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

  describe("payment connector (#665)", () => {
    const status = {
      clubName: "Club Test",
      paymentProvider: "HELLOASSO" as const,
      configured: false,
      selectableProviders: ["HELLOASSO" as const],
    };

    it("loads the club's connector for a club account", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      (PaymentProviderApi.getStatus as jest.Mock).mockResolvedValue(status);
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      expect(result.current.state.paymentProviderStatus).toEqual(status);
    });

    it("does not ask for a connector for a licensee", async () => {
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      expect(PaymentProviderApi.getStatus).not.toHaveBeenCalled();
      expect(result.current.state.paymentProviderStatus).toBeNull();
    });

    it("switches the connector and keeps the server's answer", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      (PaymentProviderApi.getStatus as jest.Mock).mockResolvedValue(status);
      const next = { ...status, paymentProvider: "OTHER" as never };
      (PaymentProviderApi.setProvider as jest.Mock).mockResolvedValue(next);
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      await act(async () => {
        await result.current.actions.handleSetPaymentProvider("OTHER" as never);
      });
      expect(PaymentProviderApi.setProvider).toHaveBeenCalledWith("OTHER");
      expect(result.current.state.paymentProviderStatus).toEqual(next);
    });

    it("does nothing when the connector is already the current one", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      (PaymentProviderApi.getStatus as jest.Mock).mockResolvedValue(status);
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      await act(async () => {
        await result.current.actions.handleSetPaymentProvider("HELLOASSO");
      });
      expect(PaymentProviderApi.setProvider).not.toHaveBeenCalled();
    });

    it("shows the server's reason when the change is refused", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({ role: "CLUB" });
      (PaymentProviderApi.getStatus as jest.Mock).mockResolvedValue(status);
      (PaymentProviderApi.setProvider as jest.Mock).mockRejectedValue(
        new PaymentProviderApiError("Pas encore disponible", 400),
      );
      const { result } = await renderHook(() =>
        useSettingsLogic({ navigation: mockNavigation }),
      );
      await act(async () => {});
      await act(async () => {
        await result.current.actions.handleSetPaymentProvider("OTHER" as never);
      });
      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Pas encore disponible",
      );
      expect(result.current.state.paymentProviderStatus).toEqual(status);
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
