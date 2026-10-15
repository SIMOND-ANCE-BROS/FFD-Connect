/**
 * #592 — a preference update racing a silent refresh must never write back
 * the refresh token the rotation has just revoked. Runs the REAL tokenStore
 * and sessionRefresh against a fake keychain: only the network is mocked.
 * Same for the impersonation switches racing a refresh (#598 review).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as SecureStore from "expo-secure-store";

import { refreshSession } from "../../../../api/sessionRefresh";
import {
  ImpersonationBackupError,
  switchToImpersonation,
} from "../../../../api/tokenStore";
import api from "../../../../services/api";
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

describe("impersonation vs. a concurrent refresh (#598 review, M1)", () => {
  const impersonateResponse = {
    data: {
      access_token: "imp",
      user: { role: "CLUB", email: "club@x.fr" },
    },
  };
  const sessionKeys = () => ({
    access: keychain["ffd.session.access"],
    refresh: keychain["ffd.session.refresh"],
  });

  beforeEach(() => {
    (api.post as jest.Mock).mockResolvedValue(impersonateResponse);
  });

  it("a refresh in flight when the impersonation starts is awaited: the backup holds the rotated tokens", async () => {
    const release = pendingRotation();
    const refreshing = refreshSession();

    const impersonating = AuthService.impersonate("t1", "Club");
    release();
    await Promise.all([refreshing, impersonating]);

    // The target's JWT, alone: no admin refresh token next to it.
    expect(sessionKeys()).toEqual({ access: "imp", refresh: undefined });
    expect(keychain["ffd.impersonation.access"]).toBe("a2");
    expect(keychain["ffd.impersonation.refresh"]).toBe("r2");

    await AuthService.stopImpersonation();
    expect(sessionKeys()).toEqual({ access: "a2", refresh: "r2" });
  });

  it("a refresh landing AFTER the switch never writes the admin's tokens over the target's", async () => {
    // The refresh read r1 before the switch; its response lands after it.
    const release = pendingRotation();
    const refreshing = refreshSession();
    await new Promise((r) => setTimeout(r, 0));
    await switchToImpersonation("imp");
    release();

    await expect(refreshing).resolves.toBeNull();
    expect(sessionKeys()).toEqual({ access: "imp", refresh: undefined });
    // The backup keeps what the switch read; the dropped refresh touched
    // nothing.
    expect(keychain["ffd.impersonation.refresh"]).toBe("r1");
  });

  it("an incomplete admin session aborts the impersonation, prefs and tokens untouched", async () => {
    delete keychain["ffd.session.refresh"];

    await expect(AuthService.impersonate("t1", "Club")).rejects.toThrow(
      ImpersonationBackupError,
    );

    expect(sessionKeys()).toEqual({ access: "a1", refresh: undefined });
    expect(keychain["ffd.impersonation.access"]).toBeUndefined();
    const prefs = JSON.parse(
      (await AsyncStorage.getItem("auth_config")) ?? "{}",
    ) as Record<string, unknown>;
    expect(prefs.impersonating).toBeUndefined();
    expect(prefs.role).toBe("LICENSEE");
    expect(await AsyncStorage.getItem("impersonation_backup")).toBeNull();
  });

  it("a stale refresh rejected (401) after a new login never ends the new session", async () => {
    // The refresh of session A is stuck on a cold start…
    let reject: (e: unknown) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((_res, rej) => (reject = rej)));
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
    const refreshing = refreshSession();
    await new Promise((r) => setTimeout(r, 0));
    // …the user logs in as B meanwhile…
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "b-a",
        refresh_token: "b-r",
        user: { role: "LICENSEE", email: "b@x.fr" },
      },
    });
    await AuthService.login("b@x.fr", "pw");
    // …then A's refresh comes back 401.
    reject({ response: { status: 401 } });

    await expect(refreshing).resolves.toBeNull();
    expect(sessionKeys()).toEqual({ access: "b-a", refresh: "b-r" });
    const prefs = JSON.parse(
      (await AsyncStorage.getItem("auth_config")) ?? "{}",
    ) as Record<string, unknown>;
    expect(prefs.isLoggedIn).toBe(true);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
  });

  it("a login after an unfinished impersonation drops the admin's backup", async () => {
    await AuthService.impersonate("t1", "Club");
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        access_token: "b-a",
        refresh_token: "b-r",
        user: { role: "LICENSEE", email: "b@x.fr" },
      },
    });

    await AuthService.login("b@x.fr", "pw");

    expect(sessionKeys()).toEqual({ access: "b-a", refresh: "b-r" });
    expect(keychain["ffd.impersonation.access"]).toBeUndefined();
    expect(keychain["ffd.impersonation.refresh"]).toBeUndefined();
    expect(await AsyncStorage.getItem("impersonation_backup")).toBeNull();
  });
});
