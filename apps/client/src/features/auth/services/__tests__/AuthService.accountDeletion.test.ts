/**
 * End of the session of an account the server has just deleted (#933): none
 * of that account's data may stay on the device, biometrics or not. Only the
 * device preferences survive (devicePreferencesOf).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearImpersonationBackupTokens } from "../../../../api/tokenStore";
import { AuthService, DEFAULT_CONFIG } from "../AuthService";

const mockUnregisterPush = jest.fn();
const mockDeleteLocalPushToken = jest.fn();
const mockClearTokens = jest.fn();
const mockRunSessionEndCleanups = jest.fn();
const mockWaitForPendingRefresh = jest.fn(async () => {});

jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: jest.fn(),
  unregisterDeviceTokenForPush: () => mockUnregisterPush() as unknown,
  deleteLocalPushToken: () => mockDeleteLocalPushToken() as unknown,
}));

jest.mock("../../../../services/sessionCleanup", () => ({
  runSessionEndCleanups: () => mockRunSessionEndCleanups() as unknown,
}));

jest.mock("../../../../api/tokenStore", () => ({
  clearTokens: () => mockClearTokens() as unknown,
  getTokens: jest.fn(async () => ({ authToken: "a", refreshToken: "r" })),
  setTokens: jest.fn(async () => {}),
  setImpersonationBackupTokens: jest.fn(async () => {}),
  clearImpersonationBackupTokens: jest.fn(async () => {}),
  switchToImpersonation: jest.fn(async () => {}),
  restoreFromImpersonation: jest.fn(async () => true),
  IMPERSONATION_BACKUP_KEY: "impersonation_backup",
}));

jest.mock("../../../../api/sessionRefresh", () => ({
  waitForPendingRefresh: () => mockWaitForPendingRefresh(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

const ACCOUNT = {
  ...DEFAULT_CONFIG,
  isLoggedIn: true,
  username: "minor@club.fr",
  userId: "deleted-id",
  role: "LICENSEE",
  roles: ["LICENSEE"],
  mainRole: "LICENSEE",
  clubName: "Club Danse",
  ageGroup: "Juvénile I",
  level: "D",
  category: "Latin",
  passportLevelLatin: "D",
  passportLevelStandard: "E",
  hasWdsfLicense: true,
  licensePhotoUri: "file:///photo.jpg",
  registrationPolicy: "CLUB_ONLY",
  clubLogoUri: "file:///logo.png",
  clubDashboardConfig: "{}",
  lastUser: "minor@club.fr",
  lastSpace: "LICENSEE",
  lastLoginDate: "2026-11-01T10:00:00.000Z",
  // Device preferences: the only fields that may stay.
  appTheme: "dark",
  animationsEnabled: false,
  defaultLibraryFilter: "likes",
  defaultCompetitionScope: "registrant",
  defaultCompetitionStatus: "PAST",
};

const stored = (config: object) =>
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(key === "auth_config" ? JSON.stringify(config) : null),
  );

const savedConfig = (): Record<string, unknown> => {
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
    (c) => c[0] === "auth_config",
  );
  expect(writes.length).toBeGreaterThan(0);
  return JSON.parse(writes[writes.length - 1][1] as string) as Record<
    string,
    unknown
  >;
};

describe("AuthService.endDeletedAccountSession (#933)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it.each([false, true])(
    "keeps only the device preferences in auth_config (biometrics: %s)",
    async (biometricsEnabled) => {
      stored({ ...ACCOUNT, biometricsEnabled });

      await AuthService.endDeletedAccountSession();

      const saved = savedConfig();
      const json = JSON.stringify(saved);
      expect(json).not.toContain("minor@club.fr");
      expect(json).not.toContain("deleted-id");
      expect(json).not.toContain("Club Danse");
      expect(json).not.toContain("file:///");
      expect(saved).toEqual({
        isLoggedIn: false,
        role: "LICENSEE",
        biometricsEnabled: false,
        appTheme: "dark",
        animationsEnabled: false,
        defaultLibraryFilter: "likes",
        defaultCompetitionScope: "registrant",
        defaultCompetitionStatus: "PAST",
      });
    },
  );

  it("wipes the tokens even when biometrics are enabled", async () => {
    stored({ ...ACCOUNT, biometricsEnabled: true });

    await AuthService.endDeletedAccountSession();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  it("wipes the offline licence snapshot and the entry QR batch even with biometrics", async () => {
    stored({ ...ACCOUNT, biometricsEnabled: true });

    await AuthService.endDeletedAccountSession();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("license_snapshot_v1");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("entry_qr_batch_v1");
  });

  it("drops the impersonation backup and runs the session-end registry", async () => {
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      "impersonation_backup",
    );
    expect(clearImpersonationBackupTokens).toHaveBeenCalled();
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
  });

  it("waits for a refresh in flight, then clears the tokens before any request", async () => {
    // A refresh racing the wipe must not write the account's preferences
    // back (endSessionState), and the push cleanup must not send the deleted
    // account's JWT (a 401 would start such a refresh).
    const order: string[] = [];
    mockWaitForPendingRefresh.mockImplementationOnce(async () => {
      order.push("waitRefresh");
    });
    mockClearTokens.mockImplementationOnce(() => {
      order.push("clearTokens");
    });
    mockDeleteLocalPushToken.mockImplementationOnce(() => {
      order.push("deleteLocalPushToken");
    });
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(order).toEqual([
      "waitRefresh",
      "clearTokens",
      "deleteLocalPushToken",
    ]);
  });

  it("sends no push unregister request: the server dropped the device with the account", async () => {
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(mockUnregisterPush).not.toHaveBeenCalled();
    expect(mockDeleteLocalPushToken).toHaveBeenCalledTimes(1);
  });

  it("still wipes everything else when the token store fails", async () => {
    mockClearTokens.mockRejectedValueOnce(new Error("keychain locked"));
    stored({ ...ACCOUNT, biometricsEnabled: true });

    await AuthService.endDeletedAccountSession();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("license_snapshot_v1");
    expect(savedConfig().username).toBeUndefined();
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
  });

  it("removes auth_config entirely when the preferences cannot be rewritten", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("full"));
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("auth_config");
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
  });

  describe("a plain logout is unchanged", () => {
    it("keeps lastUser and the tokens for a biometric unlock", async () => {
      stored({ ...ACCOUNT, biometricsEnabled: true });

      await AuthService.logout();

      expect(mockClearTokens).not.toHaveBeenCalled();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(
        "license_snapshot_v1",
      );
      expect(savedConfig()).toMatchObject({
        isLoggedIn: false,
        lastUser: "minor@club.fr",
        biometricsEnabled: true,
        clubName: "Club Danse",
      });
    });

    it("keeps lastUser on a full logout without biometrics", async () => {
      stored({ ...ACCOUNT, biometricsEnabled: false });

      await AuthService.logout();

      expect(mockClearTokens).toHaveBeenCalledTimes(1);
      expect(savedConfig()).toMatchObject({
        isLoggedIn: false,
        lastUser: "minor@club.fr",
        lastSpace: "LICENSEE",
      });
    });
  });
});
