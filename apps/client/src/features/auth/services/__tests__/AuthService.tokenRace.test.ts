/**
 * #592 — a preference update racing a silent refresh must never write back
 * the refresh token the rotation has just revoked. Runs the REAL tokenStore
 * and sessionRefresh against a fake keychain: only the network is mocked.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as SecureStore from "expo-secure-store";

import { refreshSession } from "../../../../api/sessionRefresh";
import { AuthService, type AuthConfig } from "../AuthService";

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn(() => false) },
}));
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../../../config", () => ({
  API_URL: "http://test/api/v1",
  API_TIMEOUT_MS: 1000,
}));
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ refreshAuth: jest.fn() }) },
}));
jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: jest.fn(),
  unregisterDeviceTokenForPush: jest.fn(),
}));
jest.mock("../../../../services/sessionCleanup", () => ({
  runSessionEndCleanups: jest.fn(),
}));
jest.mock("../../../../services/offlineQueueStorage", () => ({
  clearOfflineQueue: jest.fn(),
}));

const post = axios.post as jest.Mock;
const keychain: Record<string, string> = {};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(keychain)) delete keychain[k];
  keychain["ffd.session.access"] = "a1";
  keychain["ffd.session.refresh"] = "r1";
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(keychain[k] ?? null),
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    (k: string, v: string) => {
      keychain[k] = v;
      return Promise.resolve();
    },
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation((k: string) => {
    delete keychain[k];
    return Promise.resolve();
  });
  void AsyncStorage.setItem(
    "auth_config",
    JSON.stringify({ isLoggedIn: true, role: "LICENSEE", username: "u@x.fr" }),
  );
});

/** A refresh whose POST /auth/refresh resolves only when released. */
function pendingRotation(): () => void {
  let release: () => void = () => undefined;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      release = () =>
        resolve({ data: { access_token: "a2", refresh_token: "r2" } });
    }),
  );
  return () => release();
}

describe("saveAuthConfig vs. a concurrent refresh rotation (#592)", () => {
  it("a get/modify/save landing after the rotation never restores r1", async () => {
    const config: AuthConfig = await AuthService.getAuthConfig();
    expect(config.refreshToken).toBe("r1");

    post.mockResolvedValueOnce({
      data: { access_token: "a2", refresh_token: "r2" },
    });
    await refreshSession();
    expect(keychain["ffd.session.refresh"]).toBe("r2");

    await AuthService.saveAuthConfig({ ...config, appTheme: "dark" });

    expect(keychain["ffd.session.refresh"]).toBe("r2");
    expect(keychain["ffd.session.access"]).toBe("a2");
    const prefs = JSON.parse(
      (await AsyncStorage.getItem("auth_config")) ?? "{}",
    ) as Record<string, unknown>;
    expect(prefs.appTheme).toBe("dark");
    expect(prefs).not.toHaveProperty("refreshToken");
  });

  it("interleaved: a preference setter started before the rotation ends with r2", async () => {
    const release = pendingRotation();
    const refreshing = refreshSession();
    // The setter reads the config (r1) while the refresh is in flight…
    const saving = AuthService.setAppTheme("dark");
    // …and the rotation lands before or after its save: neither order may
    // put r1 back.
    release();
    await Promise.all([refreshing, saving]);

    expect(keychain["ffd.session.refresh"]).toBe("r2");
    expect(keychain["ffd.session.access"]).toBe("a2");
  });

  it("every preference setter leaves the keychain alone", async () => {
    await AuthService.setAppTheme("dark");
    await AuthService.setAnimationsEnabled(false);
    await AuthService.setDefaultLibraryFilter("likes");
    await AuthService.setActiveSpace("LICENSEE");
    await AuthService.setBiometricsEnabled(true);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
