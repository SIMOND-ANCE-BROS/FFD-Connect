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
const mockClearDeadlineReminders = jest.fn();
const mockDeleteFavoriteDownloads = jest.fn();
const mockDeleteAccountImages = jest.fn();
const mockClearCompetitionPresets = jest.fn();
const mockForgetCguAcceptance = jest.fn();

jest.mock("../../../legal/cguConsent", () => ({
  forgetCguAcceptance: (id: unknown) => mockForgetCguAcceptance(id) as unknown,
}));

jest.mock("../../../../utils/scheduleDeadlineNotification", () => ({
  clearAllDeadlineReminders: () => mockClearDeadlineReminders() as unknown,
}));

jest.mock("../../../player/services/TrackOfflineService", () => ({
  deleteFavoriteDownloads: () => mockDeleteFavoriteDownloads() as unknown,
}));

jest.mock("../../../settings/services/accountImages", () => ({
  deleteAccountImages: (uris: unknown) =>
    mockDeleteAccountImages(uris) as unknown,
}));

jest.mock("../../../../stores/competitionPresets.store", () => ({
  clearCompetitionPresets: () => mockClearCompetitionPresets() as unknown,
}));

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
  setDeletedAccountSessionHandler: jest.fn(),
}));
// Registered at import time, before any beforeEach clears the mock calls.
const deletedAccountWipe = jest.requireMock<{
  setDeletedAccountSessionHandler: jest.Mock;
}>("../../../../api/sessionRefresh").setDeletedAccountSessionHandler.mock
  .calls[0]?.[0] as (() => Promise<void>) | undefined;

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

  it("wipes the deadline reminders, offline favourites, local images and presets (#936)", async () => {
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(mockClearDeadlineReminders).toHaveBeenCalledTimes(1);
    expect(mockDeleteFavoriteDownloads).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccountImages).toHaveBeenCalledWith([
      "file:///photo.jpg",
      "file:///logo.png",
    ]);
    expect(mockClearCompetitionPresets).toHaveBeenCalledTimes(1);
  });

  // #930: no account id left on the device once the account is gone.
  it("forgets the account's local CGU acceptance copy", async () => {
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(mockForgetCguAcceptance).toHaveBeenCalledWith("deleted-id");
  });

  it("forgets no CGU copy without a known account id", async () => {
    stored({ ...ACCOUNT, userId: undefined });

    await AuthService.endDeletedAccountSession();

    expect(mockForgetCguAcceptance).not.toHaveBeenCalled();
  });

  it("keeps wiping when a local file cleanup fails", async () => {
    mockDeleteAccountImages.mockRejectedValueOnce(new Error("disk"));
    mockDeleteFavoriteDownloads.mockRejectedValueOnce(new Error("disk"));
    stored(ACCOUNT);

    await AuthService.endDeletedAccountSession();

    expect(mockClearDeadlineReminders).toHaveBeenCalledTimes(1);
    expect(savedConfig().username).toBeUndefined();
    expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
  });

  describe("account deleted from another device (#935)", () => {
    it("registers the wipe for a refresh refused with ACCOUNT_DELETED", () => {
      expect(deletedAccountWipe).toEqual(expect.any(Function));
    });

    it("wipes the account's data without waiting for the refresh it runs in", async () => {
      stored({ ...ACCOUNT, biometricsEnabled: true });

      await deletedAccountWipe?.();

      // It runs inside the refresh in flight: waiting for it would deadlock.
      expect(mockWaitForPendingRefresh).not.toHaveBeenCalled();
      const json = JSON.stringify(savedConfig());
      expect(json).not.toContain("minor@club.fr");
      expect(json).not.toContain("file:///");
      expect(savedConfig().biometricsEnabled).toBe(false);
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "license_snapshot_v1",
      );
      expect(mockClearDeadlineReminders).toHaveBeenCalledTimes(1);
      expect(mockDeleteFavoriteDownloads).toHaveBeenCalledTimes(1);
      expect(mockDeleteAccountImages).toHaveBeenCalledTimes(1);
      expect(mockForgetCguAcceptance).toHaveBeenCalledWith("deleted-id");
      expect(mockRunSessionEndCleanups).toHaveBeenCalledTimes(1);
    });
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
      // Reminders, favourites, images and presets stay for the same user.
      expect(mockClearDeadlineReminders).not.toHaveBeenCalled();
      expect(mockDeleteFavoriteDownloads).not.toHaveBeenCalled();
      expect(mockDeleteAccountImages).not.toHaveBeenCalled();
      expect(mockClearCompetitionPresets).not.toHaveBeenCalled();
      expect(mockForgetCguAcceptance).not.toHaveBeenCalled();
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
