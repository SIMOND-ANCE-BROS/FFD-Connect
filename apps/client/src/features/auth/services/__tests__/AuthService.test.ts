import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearImpersonationBackupTokens,
  getImpersonationBackupTokens,
  getTokens,
  setImpersonationBackupTokens,
  setTokens,
} from "../../../../api/tokenStore";
import { TokenStoreUnavailableError } from "../../../../api/tokenStoreErrors";
import api from "../../../../services/api";
import { usage } from "../../../../services/analytics/usage";
import { createLogger } from "../../../../utils/logger";
import {
  AuthService,
  DEFAULT_CONFIG,
  resolveSpace,
  type UserRole,
} from "../AuthService";

jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

// Sans ce mock, les tests de logout traversaient loadHandler() et chargeaient
// le VRAI @react-native-firebase/messaging : ça ne passait que par accident
// (l'exception étant capturée). L'ordre des appels est aussi ce qui permet
// d'asserter l'invariant de sécurité ci-dessous.
const mockRegisterPush = jest.fn();
const mockUnregisterPush = jest.fn();
const mockClearTokens = jest.fn();

jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: () => mockRegisterPush() as unknown,
  unregisterDeviceTokenForPush: () => mockUnregisterPush() as unknown,
}));

const mockRunSessionEndCleanups = jest.fn();
jest.mock("../../../../services/sessionCleanup", () => ({
  runSessionEndCleanups: () => mockRunSessionEndCleanups() as unknown,
}));

const mockClearOfflineQueue = jest.fn();
jest.mock("../../../../services/offlineQueueStorage", () => ({
  clearOfflineQueue: () => mockClearOfflineQueue() as unknown,
}));

jest.mock("../../../../api/tokenStore", () => ({
  clearTokens: () => mockClearTokens() as unknown,
  getTokens: jest.fn(async () => ({})),
  setTokens: jest.fn(async () => {}),
  setImpersonationBackupTokens: jest.fn(async () => {}),
  getImpersonationBackupTokens: jest.fn(async () => ({})),
  clearImpersonationBackupTokens: jest.fn(async () => {}),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe("AuthService", () => {
  let mockLogger: { info: jest.Mock; error: jest.Mock; debug: jest.Mock };

  beforeAll(() => {
    // Retrieve the logger instance created by AuthService
    // We assume AuthService was imported and triggered createLogger
    const mockCreateLogger = createLogger as jest.Mock;
    const callIndex = mockCreateLogger.mock.calls.findIndex(
      (args) => args[0] === "AuthService",
    );
    if (callIndex !== -1) {
      mockLogger = mockCreateLogger.mock.results[callIndex].value;
    } else {
      // Fallback if not found (should not happen if import works)
      mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns default config when storage is empty", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const result = await AuthService.getAuthConfig();
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it("merges stored config with defaults", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ isLoggedIn: true, role: "ADMIN" }),
    );
    const result = await AuthService.getAuthConfig();
    expect(result.isLoggedIn).toBe(true);
    expect(result.role).toBe("ADMIN");
    expect(result.animationsEnabled).toBe(true);
  });

  it("logs in and saves config", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "token",
        user: { role: "LICENSEE", clubName: "Club", email: "u@test.com" },
      },
      status: 200,
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ isLoggedIn: false }),
    );

    await AuthService.login("u@test.com", "secret");

    expect(api.post).toHaveBeenCalledWith("/auth/login", {
      username: "u@test.com",
      password: "secret",
    });
    expect(AsyncStorage.setItem).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("throws friendly error on 401", async () => {
    (api.post as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401 },
      message: "Unauthorized",
    });

    await expect(AuthService.login("u@test.com", "bad")).rejects.toThrow(
      "Identifiant ou mot de passe incorrect",
    );
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("logs out and updates storage", async () => {
    await AuthService.logout();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"isLoggedIn":false'),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("User logged out"),
    );
  });

  it("handles generic network errors", async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error("Network Error"));

    await expect(AuthService.login("u@test.com", "pw")).rejects.toThrow(
      "Network Error",
    );
  });

  it("handles generic axios errors", async () => {
    const axios = require("axios");
    jest.spyOn(axios, "isAxiosError").mockReturnValue(true);

    (api.post as jest.Mock).mockRejectedValue({
      response: { status: 500, data: {} },
      message: "Server Error",
    });

    await expect(AuthService.login("u@test.com", "pw")).rejects.toThrow(
      "Server Error",
    );
    jest.restoreAllMocks();
  });

  it("handles axios errors with data message", async () => {
    const axios = require("axios");
    jest.spyOn(axios, "isAxiosError").mockReturnValue(true);

    (api.post as jest.Mock).mockRejectedValue({
      response: { status: 400, data: { message: "Custom Error Message" } },
    });

    await expect(AuthService.login("u@test.com", "pw")).rejects.toThrow(
      "Custom Error Message",
    );
    jest.restoreAllMocks();
  });

  it("throws error on invalid server response (missing token/user)", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { access_token: null }, // Missing user
    });

    await expect(AuthService.login("u@test.com", "pw")).rejects.toThrow();
  });

  it("logs error when logout fails", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("Logout fail"),
    );

    await AuthService.logout();

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to load auth config",
      expect.any(Error),
    );
  });

  describe("register", () => {
    it("registers and saves config on success", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: "reg-token",
          user: {
            role: "LICENSEE",
            clubName: undefined,
            email: "new@test.com",
            category: "Latin",
            ageGroup: "Adult",
          },
        },
      });
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ isLoggedIn: false }),
      );

      await AuthService.register(
        "new@test.com",
        "pass123",
        "LIC-001",
        "Dupont",
      );

      expect(api.post).toHaveBeenCalledWith("/auth/register", {
        email: "new@test.com",
        password: "pass123",
        licenseNumber: "LIC-001",
        lastName: "Dupont",
      });
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "auth_config",
        expect.stringContaining('"isLoggedIn":true'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("new@test.com"),
      );
    });

    it("throws license-not-found message on 404", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 404, data: {} },
        message: "Not Found",
      });

      await expect(
        AuthService.register("a@b.com", "pw", "BAD-LIC", "Smith"),
      ).rejects.toThrow("Numéro de licence introuvable");
    });

    it("throws conflict message on 409", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 409,
          data: { message: "Email déjà utilisé" },
        },
        message: "Conflict",
      });

      await expect(
        AuthService.register("dup@b.com", "pw", "LIC-002", "Martin"),
      ).rejects.toThrow("Email déjà utilisé");
    });

    it("throws default conflict message on 409 without data message", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 409, data: {} },
        message: "Conflict",
      });

      await expect(
        AuthService.register("dup@b.com", "pw", "LIC-002", "Martin"),
      ).rejects.toThrow("Email ou licence déjà utilisé");
    });

    it("throws validation errors joined on 400 with errors array", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: { errors: ["Email invalide", "Mot de passe trop court"] },
        },
        message: "Bad Request",
      });

      await expect(
        AuthService.register("bad@b.com", "x", "LIC-003", "Durand"),
      ).rejects.toThrow("Email invalide\nMot de passe trop court");
    });

    it("throws data message on 400 without errors array", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 400, data: { message: "Données invalides" } },
        message: "Bad Request",
      });

      await expect(
        AuthService.register("bad@b.com", "x", "LIC-003", "Durand"),
      ).rejects.toThrow("Données invalides");
    });

    it("throws generic axios error message on other status", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 500, data: { message: "Server error" } },
        message: "Server Error",
      });

      await expect(
        AuthService.register("a@b.com", "pw", "LIC-004", "Test"),
      ).rejects.toThrow("Server error");
    });

    it("throws non-axios error message", async () => {
      (api.post as jest.Mock).mockRejectedValue(new Error("Network failure"));

      await expect(
        AuthService.register("a@b.com", "pw", "LIC-004", "Test"),
      ).rejects.toThrow("Network failure");
    });
  });

  it("logs in as guest", async () => {
    await AuthService.loginAsGuest();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"role":"GUEST"'),
    );
    expect(mockLogger.info).toHaveBeenCalledWith("User logged in as Guest");
  });

  it("sets biometrics enabled", async () => {
    await AuthService.setBiometricsEnabled(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"biometricsEnabled":true'),
    );
  });

  it("sets license photo", async () => {
    await AuthService.setLicensePhoto("uri://photo");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"licensePhotoUri":"uri://photo"'),
    );

    (AsyncStorage.setItem as jest.Mock).mockClear();
    await AuthService.setLicensePhoto(null);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.not.stringContaining('"licensePhotoUri":'),
    );
  });

  it("sets default library filter", async () => {
    await AuthService.setDefaultLibraryFilter("likes");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"defaultLibraryFilter":"likes"'),
    );
  });

  it("sets default competition scope and status", async () => {
    await AuthService.setDefaultCompetitionScope("registrant");
    await AuthService.setDefaultCompetitionStatus("LIVE");

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"defaultCompetitionScope":"registrant"'),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"defaultCompetitionStatus":"LIVE"'),
    );
  });

  it("sets app theme and animations", async () => {
    await AuthService.setAppTheme("dark");
    await AuthService.setAnimationsEnabled(false);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"appTheme":"dark"'),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"animationsEnabled":false'),
    );
  });

  it("sets dancer profile", async () => {
    const profile = { ageGroup: "Senior 1", level: "A", category: "Latin" };
    await AuthService.setDancerProfile(profile);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"ageGroup":"Senior 1"'),
    );
  });

  it("sets wdsf license enabled", async () => {
    await AuthService.setWdsfLicenseEnabled(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"hasWdsfLicense":true'),
    );
  });

  it("sets registration policy", async () => {
    await AuthService.setRegistrationPolicy("MEMBER_AUTO");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"registrationPolicy":"MEMBER_AUTO"'),
    );
  });

  it("fetches profile successfully", async () => {
    const profileData = { id: 1, name: "Test" };
    (api.get as jest.Mock).mockResolvedValue({ data: profileData });

    const result = await AuthService.getProfile();

    expect(result).toEqual(profileData);

    expect(api.get).toHaveBeenCalledWith("/users/me");
  });

  it("verifies WDSF license", async () => {
    const wdsfData = { min: "12345", status: "ACTIVE" };
    (api.get as jest.Mock).mockResolvedValue({ data: wdsfData });

    const result = await AuthService.verifyWdsfLicense("12345");

    expect(result).toEqual(wdsfData);

    expect(api.get).toHaveBeenCalledWith("/wdsf/athlete/12345");
  });

  it("throws error when WDSF license verification fails", async () => {
    (api.get as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "Not found" } },
    });

    await expect(AuthService.verifyWdsfLicense("00000")).rejects.toThrow(
      "Not found",
    );
  });

  it("handles storage errors in getAuthConfig", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("Disk error"),
    );

    const result = await AuthService.getAuthConfig();
    expect(result).toEqual(DEFAULT_CONFIG);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to load auth config",
      expect.any(Error),
    );
  });

  it("keeps the stored session when the token store is unreadable (locked iPhone, #582)", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ isLoggedIn: true, role: "ADMIN", username: "u@t.fr" }),
    );
    (getTokens as jest.Mock).mockRejectedValueOnce(
      new TokenStoreUnavailableError(
        new Error("User interaction is not allowed."),
      ),
    );

    const result = await AuthService.getAuthConfig();

    // Not DEFAULT_CONFIG: a later saveAuthConfig must not persist a logout.
    expect(result.isLoggedIn).toBe(true);
    expect(result.role).toBe("ADMIN");
    expect(result.authToken).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it("handles storage errors in saveAuthConfig", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(
      new Error("Disk error"),
    );

    await AuthService.saveAuthConfig(DEFAULT_CONFIG);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to save auth config",
      expect.any(Error),
    );
  });

  describe("Password Management", () => {
    it("calls forgotPassword API", async () => {
      (api.post as jest.Mock).mockResolvedValue({ status: 200 });

      await AuthService.forgotPassword("test@example.com");

      expect(api.post).toHaveBeenCalledWith("/auth/forgot-password", {
        email: "test@example.com",
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("test@example.com"),
      ); // This one might be tricky if add calls were removed in source. Source now uses .info or .error.
      // Wait, in AuthService I changed it to .info or .error.
      // Line 166 in source: logger.info('Login attempt', { email: username });
      // Line 363 (forgot password): logger.add(`Password reset requested for ${email}`); -> NEED TO CHECK SOURCE.
      // I will check source first or just assume I replaced it with info.
      // In step 132/138 I replaced usages in AuthService.ts.
      // login success: .info
      // login failed: .error -> wait, step 138 shows logger.info for login attempt.
      // I replaced 3 chunks in step 132.
      // Chunk 1: Login attempt -> logger.info
      // Chunk 2: Login successful -> logger.info
      // Chunk 3: Login failed -> logger.error
      // I need to be careful with line numbers.
    });

    it("handles forgotPassword error", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: "User not found" } },
      });

      await expect(
        AuthService.forgotPassword("unknown@example.com"),
      ).rejects.toThrow("User not found");
    });

    it("calls resetPassword API", async () => {
      (api.post as jest.Mock).mockResolvedValue({ status: 200 });

      await AuthService.resetPassword("token123", "new-pass");

      expect(api.post).toHaveBeenCalledWith("/auth/reset-password", {
        token: "token123",
        newPassword: "new-pass",
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Password reset successfully",
      );
    });

    it("handles resetPassword validation errors", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: {
          data: { errors: ["Password too weak", "Too short"] },
        },
      });

      await expect(AuthService.resetPassword("token", "123")).rejects.toThrow(
        "Password too weak\nToo short",
      );
    });

    it("calls changePassword API", async () => {
      (api.post as jest.Mock).mockResolvedValue({ status: 200 });

      await AuthService.changePassword("old-pass", "new-pass");

      expect(api.post).toHaveBeenCalledWith("/auth/change-password", {
        currentPassword: "old-pass",
        newPassword: "new-pass",
      });
    });
  });

  it("handles getProfile error", async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error("Fetch fail"));
    await expect(AuthService.getProfile()).rejects.toThrow("Fetch fail");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to fetch profile",
      expect.any(Error),
    );
  });

  it("handles verifyWdsfLicense non-axios error", async () => {
    (api.get as jest.Mock).mockImplementation(() => {
      throw new Error("Random error");
    });
    await expect(AuthService.verifyWdsfLicense("123")).rejects.toThrow(
      "Random error",
    );
  });

  it("handles forgotPassword non-axios error", async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error("Send fail"));
    await expect(AuthService.forgotPassword("a@b.com")).rejects.toThrow(
      "Send fail",
    );
  });

  it("handles resetPassword with data message fallback", async () => {
    (api.post as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "Fallback reset error" } },
    });
    await expect(AuthService.resetPassword("t", "p")).rejects.toThrow(
      "Fallback reset error",
    );
  });

  it("handles changePassword with errors array and data message fallback", async () => {
    // Branch with errors array
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { errors: ["Weak"] } },
    });
    await expect(AuthService.changePassword("o", "n")).rejects.toThrow("Weak");

    // Branch with generic message
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: "Generic change fail" } },
    });
    await expect(AuthService.changePassword("o", "n")).rejects.toThrow(
      "Generic change fail",
    );
  });

  it("handles logout error", async () => {
    const saveSpy = jest
      .spyOn(AuthService, "saveAuthConfig")
      .mockRejectedValueOnce(new Error("Save fail"));

    await AuthService.logout();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to logout",
      expect.any(Error),
    );
    saveSpy.mockRestore();
  });

  it("handles resetPassword non-axios error", async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error("Reset fail"));
    await expect(AuthService.resetPassword("t", "p")).rejects.toThrow(
      "Reset fail",
    );
  });

  it("handles changePassword with missing response data message", async () => {
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: {} }, // No message or errors
    });
    await expect(AuthService.changePassword("o", "n")).rejects.toThrow(
      "Erreur lors du changement de mot de passe.",
    );
  });

  it("handles changePassword non-axios error", async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error("Change fail"));
    await expect(AuthService.changePassword("o", "n")).rejects.toThrow(
      "Change fail",
    );
  });

  describe("impersonation (#545)", () => {
    beforeEach(() => {
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    });

    it("sauvegarde la session, échange le token, passe en impersonating", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ role: "ADMIN", username: "admin@test.com" }),
      );
      (api.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: "imp-tok",
          user: { role: "CLUB", email: "club@test.com", clubName: "C" },
        },
      });

      await AuthService.impersonate("target-1", "Test Club");

      expect(api.post).toHaveBeenCalledWith("/auth/impersonate", {
        targetUserId: "target-1",
        reason: undefined,
      });
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "impersonation_backup",
        expect.any(String),
      );
      const authWrite = (AsyncStorage.setItem as jest.Mock).mock.calls.find(
        (c) => c[0] === "auth_config",
      ) as [string, string] | undefined;
      expect(authWrite).toBeDefined();
      const saved = JSON.parse(authWrite![1]) as {
        impersonating?: boolean;
        role?: string;
      };
      expect(saved.impersonating).toBe(true);
      expect(saved.role).toBe("CLUB");
      // The admin's offline license snapshot does not cross the switch.
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "license_snapshot_v1",
      );
    });

    it("stopImpersonation restaure la sauvegarde et appelle /stop", async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
        Promise.resolve(
          k === "impersonation_backup"
            ? JSON.stringify({ role: "ADMIN", isLoggedIn: true })
            : null,
        ),
      );
      (getImpersonationBackupTokens as jest.Mock).mockResolvedValueOnce({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      (api.post as jest.Mock).mockResolvedValue({ data: {} });

      await AuthService.stopImpersonation();

      expect(api.post).toHaveBeenCalledWith("/auth/impersonate/stop", {});
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "impersonation_backup",
      );
      // Nor does the target's (never saved, but purged defensively).
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "license_snapshot_v1",
      );
    });
  });

  describe("impersonation backup out of plaintext (#591)", () => {
    const writesOf = (key: string): string[] =>
      (AsyncStorage.setItem as jest.Mock).mock.calls
        .filter((c) => c[0] === key)
        .map((c) => c[1] as string);
    const noTokenIn = (json: string) => {
      expect(json).not.toMatch(/authToken|refreshToken|admin-a|admin-r/);
    };
    const order: string[] = [];

    beforeEach(() => {
      order.length = 0;
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
      (getTokens as jest.Mock).mockResolvedValue({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      (getImpersonationBackupTokens as jest.Mock).mockResolvedValue({});
      (setImpersonationBackupTokens as jest.Mock).mockImplementation(
        async () => {
          order.push("backupTokens");
        },
      );
      mockClearTokens.mockImplementation(async () => {
        order.push("clearTokens");
      });
      (setTokens as jest.Mock).mockImplementation(async () => {
        order.push("setTokens");
      });
    });

    afterAll(() => {
      (getTokens as jest.Mock).mockResolvedValue({});
      mockClearTokens.mockReset();
      (setImpersonationBackupTokens as jest.Mock).mockResolvedValue(undefined);
      (setTokens as jest.Mock).mockResolvedValue(undefined);
    });

    const impersonateTarget = () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ role: "ADMIN", username: "admin@test.com" }),
      );
      (api.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: "imp-tok",
          user: { role: "CLUB", email: "club@test.com" },
        },
      });
      return AuthService.impersonate("target-1", "Test Club");
    };

    it("impersonate backs the admin's tokens up in SecureStore, never in AsyncStorage", async () => {
      await impersonateTarget();

      expect(setImpersonationBackupTokens).toHaveBeenCalledWith({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      const backups = writesOf("impersonation_backup");
      expect(backups).toHaveLength(1);
      noTokenIn(backups[0]);
      expect(JSON.parse(backups[0])).toMatchObject({
        role: "ADMIN",
        username: "admin@test.com",
      });
      writesOf("auth_config").forEach(noTokenIn);
      // Backup before the admin's session is wiped, then the target's token.
      expect(order).toEqual(["backupTokens", "clearTokens", "setTokens"]);
      expect(setTokens).toHaveBeenCalledWith({ authToken: "imp-tok" });
    });

    it("impersonate switches nothing when the admin's tokens cannot be read", async () => {
      // First read: getAuthConfig (which tolerates it); second: the backup.
      (getTokens as jest.Mock)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(
          new TokenStoreUnavailableError(new Error("Keystore failure")),
        );

      await expect(impersonateTarget()).rejects.toThrow(
        "Secure token store unavailable",
      );

      expect(setImpersonationBackupTokens).not.toHaveBeenCalled();
      expect(mockClearTokens).not.toHaveBeenCalled();
      expect(writesOf("auth_config")).toHaveLength(0);
    });

    it("stopImpersonation restores the admin's tokens and preferences, then drops the backup", async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
        Promise.resolve(
          k === "impersonation_backup"
            ? JSON.stringify({ role: "ADMIN", isLoggedIn: true })
            : null,
        ),
      );
      (getImpersonationBackupTokens as jest.Mock).mockResolvedValue({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      (api.post as jest.Mock).mockResolvedValue({ data: {} });

      await AuthService.stopImpersonation();

      expect(order).toEqual(["clearTokens", "setTokens"]);
      expect(setTokens).toHaveBeenCalledWith({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      const saved = writesOf("auth_config");
      expect(saved).toHaveLength(1);
      noTokenIn(saved[0]);
      expect(JSON.parse(saved[0])).toMatchObject({
        role: "ADMIN",
        isLoggedIn: true,
      });
      expect(clearImpersonationBackupTokens).toHaveBeenCalled();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "impersonation_backup",
      );
    });

    it("stopImpersonation restores a pre-#591 plaintext backup, moving its tokens first", async () => {
      // Stateful AsyncStorage + SecureStore backup.
      const kv = new Map<string, string>([
        [
          "impersonation_backup",
          JSON.stringify({
            role: "ADMIN",
            isLoggedIn: true,
            authToken: "admin-a",
            refreshToken: "admin-r",
          }),
        ],
      ]);
      let secure: Record<string, string | undefined> = {};
      (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
        Promise.resolve(kv.get(k) ?? null),
      );
      (AsyncStorage.setItem as jest.Mock).mockImplementation(
        (k: string, v: string) => {
          kv.set(k, v);
          return Promise.resolve();
        },
      );
      (AsyncStorage.removeItem as jest.Mock).mockImplementation((k: string) => {
        kv.delete(k);
        return Promise.resolve();
      });
      (setImpersonationBackupTokens as jest.Mock).mockImplementation(
        (t: Record<string, string | undefined>) => {
          secure = { ...t };
          return Promise.resolve();
        },
      );
      (getImpersonationBackupTokens as jest.Mock).mockImplementation(() =>
        Promise.resolve(secure),
      );
      (api.post as jest.Mock).mockResolvedValue({ data: {} });

      await AuthService.stopImpersonation();

      expect(setTokens).toHaveBeenCalledWith({
        authToken: "admin-a",
        refreshToken: "admin-r",
      });
      writesOf("impersonation_backup").forEach(noTokenIn);
      writesOf("auth_config").forEach(noTokenIn);
      expect(kv.has("impersonation_backup")).toBe(false);
      expect(JSON.parse(kv.get("auth_config")!)).toMatchObject({
        role: "ADMIN",
        isLoggedIn: true,
      });
    });

    it("stopImpersonation without the admin's tokens ends on the login screen", async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
        Promise.resolve(
          k === "impersonation_backup"
            ? "{not json"
            : JSON.stringify({
                isLoggedIn: true,
                role: "CLUB",
                impersonating: true,
                impersonatedName: "Test Club",
              }),
        ),
      );
      (api.post as jest.Mock).mockRejectedValue(new Error("offline"));

      await AuthService.stopImpersonation();

      expect(setTokens).not.toHaveBeenCalled();
      expect(mockClearTokens).toHaveBeenCalled();
      const saved = JSON.parse(writesOf("auth_config").pop()!) as Record<
        string,
        unknown
      >;
      expect(saved.isLoggedIn).toBe(false);
      expect(saved.impersonating).toBeUndefined();
      expect(saved.impersonatedName).toBeUndefined();
    });

    it("stopImpersonation switches nothing when the backup cannot be read", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      (getImpersonationBackupTokens as jest.Mock).mockRejectedValueOnce(
        new TokenStoreUnavailableError(new Error("Keystore failure")),
      );
      (api.post as jest.Mock).mockResolvedValue({ data: {} });

      await expect(AuthService.stopImpersonation()).rejects.toThrow(
        "Secure token store unavailable",
      );

      expect(mockClearTokens).not.toHaveBeenCalled();
      expect(writesOf("auth_config")).toHaveLength(0);
    });

    describe("launch migration", () => {
      it("moves the tokens to SecureStore, then strips them from the blob", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({
            role: "ADMIN",
            authToken: "admin-a",
            refreshToken: "admin-r",
          }),
        );

        await AuthService.migrateImpersonationBackup();

        expect(setImpersonationBackupTokens).toHaveBeenCalledWith({
          authToken: "admin-a",
          refreshToken: "admin-r",
        });
        const rewritten = writesOf("impersonation_backup");
        expect(rewritten).toHaveLength(1);
        noTokenIn(rewritten[0]);
        expect(JSON.parse(rewritten[0])).toEqual({ role: "ADMIN" });
        expect(order[0]).toBe("backupTokens");
      });

      it("ignores a non-string token value but still strips its key", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({ role: "ADMIN", authToken: null }),
        );

        await AuthService.migrateImpersonationBackup();

        expect(setImpersonationBackupTokens).toHaveBeenCalledWith({
          authToken: undefined,
          refreshToken: undefined,
        });
        expect(writesOf("impersonation_backup")).toEqual([
          JSON.stringify({ role: "ADMIN" }),
        ]);
      });

      it("does nothing without a backup, or with a backup already free of tokens", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
        await AuthService.migrateImpersonationBackup();
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
          JSON.stringify({ role: "ADMIN" }),
        );
        await AuthService.migrateImpersonationBackup();

        expect(setImpersonationBackupTokens).not.toHaveBeenCalled();
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      });

      it("drops an unparsable backup (it may hold tokens)", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue("{broken");

        await AuthService.migrateImpersonationBackup();

        expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
          "impersonation_backup",
        );
        expect(setImpersonationBackupTokens).not.toHaveBeenCalled();
      });

      it("keeps the blob untouched when SecureStore refuses the write, and never throws", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({ role: "ADMIN", authToken: "admin-a" }),
        );
        (setImpersonationBackupTokens as jest.Mock).mockRejectedValueOnce(
          new Error("User interaction is not allowed."),
        );

        await expect(
          AuthService.migrateImpersonationBackup(),
        ).resolves.toBeUndefined();

        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
          "Failed to migrate the impersonation backup",
          expect.any(Error),
        );
      });
    });

    describe("logout", () => {
      it("drops both halves of the backup", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({ ...DEFAULT_CONFIG, isLoggedIn: true }),
        );

        await AuthService.logout();

        expect(clearImpersonationBackupTokens).toHaveBeenCalled();
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
          "impersonation_backup",
        );
      });

      it("never keeps an impersonation for a biometric unlock", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({
            ...DEFAULT_CONFIG,
            isLoggedIn: true,
            biometricsEnabled: true,
            impersonating: true,
            impersonatedName: "Test Club",
          }),
        );

        await AuthService.logout();

        expect(mockClearTokens).toHaveBeenCalled();
        const saved = JSON.parse(writesOf("auth_config").pop()!) as Record<
          string,
          unknown
        >;
        expect(saved.impersonating).toBeUndefined();
        expect(saved.impersonatedName).toBeUndefined();
        expect(saved.biometricsEnabled).toBe(true);
      });

      it("still logs out when the backup cannot be cleared", async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
          JSON.stringify({ ...DEFAULT_CONFIG, isLoggedIn: true }),
        );
        (clearImpersonationBackupTokens as jest.Mock).mockRejectedValueOnce(
          new Error("Keystore failure"),
        );

        await AuthService.logout();

        const saved = JSON.parse(writesOf("auth_config").pop()!) as Record<
          string,
          unknown
        >;
        expect(saved.isLoggedIn).toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
          "Failed to clear the impersonation backup",
          expect.any(Error),
        );
      });
    });
  });

  describe("token writes (#592)", () => {
    beforeEach(() => {
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    });

    it("saveAuthConfig writes the preferences only, never the tokens", async () => {
      await AuthService.saveAuthConfig({
        ...DEFAULT_CONFIG,
        isLoggedIn: true,
        authToken: "stale-a",
        refreshToken: "stale-r",
      });

      expect(setTokens).not.toHaveBeenCalled();
      const [key, json] = (AsyncStorage.setItem as jest.Mock).mock.calls[0] as [
        string,
        string,
      ];
      expect(key).toBe("auth_config");
      expect(json).not.toMatch(/authToken|refreshToken|stale/);
    });

    it.each([
      ["login", () => AuthService.login("u@x.fr", "pw")],
      [
        "register",
        () => AuthService.register("u@x.fr", "pw", "123", "Doe", "Jane"),
      ],
    ])(
      "%s writes the new tokens explicitly, before the logged-in prefs",
      async (_name, run) => {
        const order: string[] = [];
        (setTokens as jest.Mock).mockImplementationOnce(async () => {
          order.push("setTokens");
        });
        (AsyncStorage.setItem as jest.Mock).mockImplementation(
          async (k: string) => {
            order.push(k);
          },
        );
        (api.post as jest.Mock).mockResolvedValueOnce({
          data: {
            access_token: "a2",
            refresh_token: "r2",
            user: { email: "u@x.fr", role: "LICENSEE" },
          },
        });

        await run();

        expect(setTokens).toHaveBeenCalledWith({
          authToken: "a2",
          refreshToken: "r2",
        });
        expect(order).toEqual(["setTokens", "auth_config"]);
        (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      },
    );

    it("preference setters never touch the tokens", async () => {
      (getTokens as jest.Mock).mockResolvedValueOnce({
        authToken: "a1",
        refreshToken: "r1",
      });

      await AuthService.setAppTheme("dark");

      expect(setTokens).not.toHaveBeenCalled();
    });
  });
});

describe("AuthService — câblage des notifications push", () => {
  beforeEach(() => {
    mockRegisterPush.mockClear();
    mockUnregisterPush.mockClear();
    mockClearTokens.mockClear();
    mockClearOfflineQueue.mockClear();
  });

  it("enregistre l'appareil après un login réussi", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "a",
        refresh_token: "r",
        user: { email: "u@x.fr", role: "LICENSEE" },
      },
    });

    await AuthService.login("u@x.fr", "pw");

    expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  });

  it("désenregistre AVANT d'effacer les tokens sur un logout complet", async () => {
    // L'invariant de sécurité de tout le design : le DELETE est authentifié,
    // donc il doit partir tant que le JWT est valide. Un refactor qui inverse
    // ces deux lignes casse la fonctionnalité en silence.
    const order: string[] = [];
    mockUnregisterPush.mockImplementation(() => {
      order.push("unregister");
    });
    mockClearTokens.mockImplementation(() => {
      order.push("clearTokens");
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_CONFIG, biometricsEnabled: false }),
    );

    await AuthService.logout();

    expect(order).toEqual(["unregister", "clearTokens"]);
  });

  it.each([false, true])(
    "purge le cache serveur à la déconnexion (biométrie : %s)",
    async (biometricsEnabled) => {
      mockRunSessionEndCleanups.mockClear();
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ ...DEFAULT_CONFIG, biometricsEnabled }),
      );

      await AuthService.logout();

      expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
    },
  );

  it("ne désenregistre PAS sur le verrouillage biométrique", async () => {
    // Le chemin biométrique ne fait que verrouiller l'app pour le MÊME
    // utilisateur : couper le token y tuerait les push pour les utilisateurs
    // Face ID, ceux qui rouvrent l'app le plus souvent.
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_CONFIG, biometricsEnabled: true }),
    );

    await AuthService.logout();

    expect(mockUnregisterPush).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
    // Same user unlocks with biometrics: pending offline actions stay.
    expect(mockClearOfflineQueue).not.toHaveBeenCalled();
  });

  it("délègue la purge de la file hors ligne à clearTokens (#416)", async () => {
    // La file ne part plus d'ici : `clearTokens` la purge, pour couvrir aussi
    // les fins de session qui ne passent pas par `logout()` (refresh token
    // expiré, bascules d'impersonation). Ce test verrouille la délégation ;
    // la purge elle-même est couverte dans tokenStore.test.ts.
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_CONFIG, biometricsEnabled: false }),
    );

    await AuthService.logout();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(mockClearOfflineQueue).not.toHaveBeenCalled();
  });
});

describe("resolveSpace", () => {
  const base = {
    user: "a@x.fr",
    mainRole: "ADMIN" as const,
    roles: ["ADMIN", "LICENSEE"] as UserRole[],
  };

  it("defaults to the main role", () => {
    expect(resolveSpace(base)).toBe("ADMIN");
  });

  it("keeps the previous space of the same account", () => {
    expect(
      resolveSpace({
        ...base,
        previousUser: "a@x.fr",
        previousSpace: "LICENSEE",
      }),
    ).toBe("LICENSEE");
  });

  it("ignores the previous space of another account", () => {
    expect(
      resolveSpace({
        ...base,
        previousUser: "b@x.fr",
        previousSpace: "LICENSEE",
      }),
    ).toBe("ADMIN");
  });

  it("falls back to the main role when the space was removed", () => {
    expect(
      resolveSpace({ ...base, previousUser: "a@x.fr", previousSpace: "CLUB" }),
    ).toBe("ADMIN");
  });
});

describe("AuthService — multi-role", () => {
  const lastSaved = () => {
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    return JSON.parse(calls[calls.length - 1][1] as string) as Record<
      string,
      unknown
    >;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it("login stores every role and the main role, and keeps role = active space", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "t",
        refresh_token: "r",
        user: { email: "a@x.fr", role: "ADMIN", roles: ["ADMIN", "LICENSEE"] },
      },
    });
    await AuthService.login("a@x.fr", "pw");
    expect(lastSaved()).toMatchObject({
      role: "ADMIN",
      mainRole: "ADMIN",
      roles: ["ADMIN", "LICENSEE"],
    });
  });

  it("login keeps the previous space of the same account", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ username: "a@x.fr", role: "LICENSEE" }),
    );
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "t",
        refresh_token: "r",
        user: { email: "a@x.fr", role: "ADMIN", roles: ["ADMIN", "LICENSEE"] },
      },
    });
    await AuthService.login("a@x.fr", "pw");
    expect(lastSaved()).toMatchObject({ role: "LICENSEE", mainRole: "ADMIN" });
  });

  it("login against an older backend without roles stores [role]", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "t",
        refresh_token: "r",
        user: { email: "a@x.fr", role: "LICENSEE" },
      },
    });
    await AuthService.login("a@x.fr", "pw");
    expect(lastSaved()).toMatchObject({
      role: "LICENSEE",
      roles: ["LICENSEE"],
    });
  });

  it("impersonate opens on the target's main role with its roles", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "t",
        user: { email: "c@x.fr", role: "CLUB", roles: ["CLUB", "LICENSEE"] },
      },
    });
    await AuthService.impersonate("u1", "Club Name");
    expect(lastSaved()).toMatchObject({
      role: "CLUB",
      mainRole: "CLUB",
      roles: ["CLUB", "LICENSEE"],
      impersonating: true,
    });
  });

  it("setActiveSpace switches to a held role", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ role: "ADMIN", roles: ["ADMIN", "LICENSEE"] }),
    );
    await AuthService.setActiveSpace("LICENSEE");
    expect(lastSaved()).toMatchObject({ role: "LICENSEE" });
  });

  it("setActiveSpace is a no-op for a role the account does not hold", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ role: "ADMIN", roles: ["ADMIN", "LICENSEE"] }),
    );
    await AuthService.setActiveSpace("CLUB");
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("logout clears roles and mainRole", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        role: "ADMIN",
        mainRole: "ADMIN",
        roles: ["ADMIN", "LICENSEE"],
      }),
    );
    await AuthService.logout();
    const saved = lastSaved();
    expect(saved.roles).toBeUndefined();
    expect(saved.mainRole).toBeUndefined();
    expect(saved.role).toBe("LICENSEE");
  });

  describe("syncRolesFromProfile", () => {
    const loggedIn = {
      isLoggedIn: true,
      username: "a@x.fr",
      role: "LICENSEE",
      roles: ["LICENSEE"],
      mainRole: "LICENSEE",
    };

    it("persists the store-review flag and marks the usage context", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(loggedIn),
      );
      const next = await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE"],
        isStoreReview: true,
      });
      expect(lastSaved()).toMatchObject({ isStoreReview: true });
      expect(usage.contextFromConfig(next)).toEqual({
        space: "LICENSEE",
        storeReview: true,
      });
    });

    it("adds a role granted meanwhile and keeps the current space", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(loggedIn),
      );
      const next = await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE", "CLUB"],
      });
      expect(lastSaved()).toMatchObject({
        role: "LICENSEE",
        roles: ["LICENSEE", "CLUB"],
        mainRole: "LICENSEE",
      });
      expect(next.roles).toEqual(["LICENSEE", "CLUB"]);
    });

    it("falls back to the main role when the active space was removed", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({
          ...loggedIn,
          role: "CLUB",
          roles: ["LICENSEE", "CLUB"],
        }),
      );
      await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE"],
      });
      expect(lastSaved()).toMatchObject({
        role: "LICENSEE",
        roles: ["LICENSEE"],
      });
    });

    it("follows a main role change and an older backend without roles", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(loggedIn),
      );
      await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "CLUB",
      });
      expect(lastSaved()).toMatchObject({
        role: "CLUB",
        roles: ["CLUB"],
        mainRole: "CLUB",
      });
    });

    it("writes nothing when logged out or browsing as a guest", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ isLoggedIn: true, isGuest: true, role: "GUEST" }),
      );
      await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
      });
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ isLoggedIn: false, role: "LICENSEE" }),
      );
      await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
      });
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it("writes nothing when the roles did not change (no extra work on each visit)", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(loggedIn),
      );
      await AuthService.syncRolesFromProfile({
        email: "a@x.fr",
        role: "LICENSEE",
        roles: ["LICENSEE"],
      });
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe("space memory across logout", () => {
    const dualUser = {
      email: "a@x.fr",
      role: "LICENSEE",
      roles: ["LICENSEE", "CLUB"],
    };
    const loginAs = (user: object) =>
      (api.post as jest.Mock).mockResolvedValueOnce({
        data: { access_token: "t", refresh_token: "r", user },
      });

    it("logout keeps the last account and its space", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({
          isLoggedIn: true,
          username: "a@x.fr",
          role: "CLUB",
          roles: ["LICENSEE", "CLUB"],
          mainRole: "LICENSEE",
        }),
      );
      await AuthService.logout();
      const saved = lastSaved();
      expect(saved.username).toBeUndefined();
      expect(saved).toMatchObject({ lastUser: "a@x.fr", lastSpace: "CLUB" });
    });

    it("a logout without an account (guest) keeps the previous memory", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({
          isLoggedIn: true,
          isGuest: true,
          role: "GUEST",
          lastUser: "a@x.fr",
          lastSpace: "CLUB",
        }),
      );
      await AuthService.logout();
      expect(lastSaved()).toMatchObject({
        lastUser: "a@x.fr",
        lastSpace: "CLUB",
      });
    });

    it("the next login of the same account reopens the last space", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({
          isLoggedIn: false,
          role: "LICENSEE",
          lastUser: "a@x.fr",
          lastSpace: "CLUB",
        }),
      );
      loginAs(dualUser);
      await AuthService.login("a@x.fr", "pw");
      expect(lastSaved()).toMatchObject({ role: "CLUB", mainRole: "LICENSEE" });
    });

    it("another account opens on its own main role", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({
          isLoggedIn: false,
          role: "LICENSEE",
          lastUser: "b@x.fr",
          lastSpace: "CLUB",
        }),
      );
      loginAs(dualUser);
      await AuthService.login("a@x.fr", "pw");
      expect(lastSaved()).toMatchObject({ role: "LICENSEE" });
    });
  });
});
