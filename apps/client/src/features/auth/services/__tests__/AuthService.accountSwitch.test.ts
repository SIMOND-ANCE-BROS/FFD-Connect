/**
 * Another account logging in on the same device (#940, #913): it starts from
 * the device preferences only. The previous account's local profile (licence
 * photo, level, WDSF flag, club settings…), its files, reminders, offline
 * favourites, saved programmes, licence snapshot and offline queue go. The
 * same account logging in again keeps them, as before.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import api from "../../../../services/api";
import { getTokens } from "../../../../api/tokenStore";
import { AuthService, DEFAULT_CONFIG } from "../AuthService";

const mockClearTokens = jest.fn();
const mockSetTokens = jest.fn();
const mockRunSessionEndCleanups = jest.fn();
const mockClearDeadlineReminders = jest.fn();
const mockDeleteFavoriteDownloads = jest.fn();
const mockDeleteAccountImages = jest.fn();
const mockClearCompetitionPresets = jest.fn();
const mockClearLicenseSnapshot = jest.fn();
const mockForgetCguAcceptance = jest.fn();

jest.mock("../../../legal/cguConsent", () => ({
  forgetCguAcceptance: (id: unknown) => mockForgetCguAcceptance(id) as unknown,
}));

jest.mock("../../../license/utils/licenseSnapshot", () => ({
  clearLicenseSnapshot: () => mockClearLicenseSnapshot() as unknown,
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
  unregisterDeviceTokenForPush: jest.fn(),
  deleteLocalPushToken: jest.fn(),
}));

jest.mock("../../../../services/sessionCleanup", () => ({
  runSessionEndCleanups: () => mockRunSessionEndCleanups() as unknown,
}));

jest.mock("../../../../api/tokenStore", () => ({
  clearTokens: () => mockClearTokens() as unknown,
  getTokens: jest.fn(async () => ({})),
  setTokens: (t: unknown) => mockSetTokens(t) as unknown,
  setImpersonationBackupTokens: jest.fn(async () => {}),
  clearImpersonationBackupTokens: jest.fn(async () => {}),
  switchToImpersonation: jest.fn(async () => {}),
  restoreFromImpersonation: jest.fn(async () => true),
  IMPERSONATION_BACKUP_KEY: "impersonation_backup",
}));

jest.mock("../../../../api/sessionRefresh", () => ({
  waitForPendingRefresh: jest.fn(async () => {}),
  setDeletedAccountSessionHandler: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

/** Account A, logged out without biometrics: what logout() leaves. */
const LOGGED_OUT_A = {
  ...DEFAULT_CONFIG,
  isLoggedIn: false,
  role: "LICENSEE",
  clubName: "Club A",
  ageGroup: "Juvénile I",
  level: "D",
  category: "Latin",
  passportLevelLatin: "D",
  passportLevelStandard: "E",
  hasWdsfLicense: true,
  licensePhotoUri: "file:///docs/photo-a.jpg",
  registrationPolicy: "CLUB_ONLY",
  clubLogoUri: "file:///docs/logo-a.png",
  clubDashboardConfig: '{"widgets":["a"]}',
  lastUser: "a@club.fr",
  lastUserId: "id-a",
  lastSpace: "CLUB",
  isStoreReview: true,
  lastLoginDate: "2026-11-01T10:00:00.000Z",
  // Device preferences: the only fields that cross an account switch.
  appTheme: "dark",
  animationsEnabled: false,
  defaultLibraryFilter: "likes",
  defaultCompetitionScope: "registrant",
  defaultCompetitionStatus: "PAST",
};

const A_LOCAL_SETTINGS = {
  level: "D",
  hasWdsfLicense: true,
  licensePhotoUri: "file:///docs/photo-a.jpg",
  registrationPolicy: "CLUB_ONLY",
  clubLogoUri: "file:///docs/logo-a.png",
  clubDashboardConfig: '{"widgets":["a"]}',
};

const userA = { id: "id-a", email: "a@club.fr", role: "LICENSEE" };
const userB = {
  id: "id-b",
  email: "b@club.fr",
  role: "LICENSEE",
  clubName: "Club B",
};

/** An unsigned JWT naming `sub`: only its payload is ever read. */
const jwtFor = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const stored = (config: object) =>
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(key === "auth_config" ? JSON.stringify(config) : null),
  );

const respondWith = (user: object) =>
  (api.post as jest.Mock).mockResolvedValueOnce({
    data: { access_token: "new-at", refresh_token: "new-rt", user },
  });

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

const expectPreviousAccountWiped = () => {
  expect(mockDeleteAccountImages).toHaveBeenCalledWith([
    "file:///docs/photo-a.jpg",
    "file:///docs/logo-a.png",
  ]);
  expect(mockClearDeadlineReminders).toHaveBeenCalledTimes(1);
  expect(mockDeleteFavoriteDownloads).toHaveBeenCalledTimes(1);
  expect(mockClearCompetitionPresets).toHaveBeenCalledTimes(1);
  expect(mockClearLicenseSnapshot).toHaveBeenCalledTimes(1);
  // The previous account's retained tokens and offline queue.
  expect(mockClearTokens).toHaveBeenCalledTimes(1);
};

const expectNothingWiped = () => {
  expect(mockDeleteAccountImages).not.toHaveBeenCalled();
  expect(mockClearDeadlineReminders).not.toHaveBeenCalled();
  expect(mockDeleteFavoriteDownloads).not.toHaveBeenCalled();
  expect(mockClearCompetitionPresets).not.toHaveBeenCalled();
  expect(mockClearLicenseSnapshot).not.toHaveBeenCalled();
  expect(mockClearTokens).not.toHaveBeenCalled();
};

describe("AuthService — account switch on the same device (#940, #913)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    (getTokens as jest.Mock).mockResolvedValue({});
  });

  describe("another account logs in", () => {
    it("starts from the device preferences only", async () => {
      stored(LOGGED_OUT_A);
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      const saved = savedConfig();
      const json = JSON.stringify(saved);
      expect(json).not.toContain("a@club.fr");
      expect(json).not.toContain("id-a");
      expect(json).not.toContain("Club A");
      expect(json).not.toContain("file:///");
      expect(json).not.toContain("widgets");
      expect(saved.level).toBeUndefined();
      expect(saved.registrationPolicy).toBe(DEFAULT_CONFIG.registrationPolicy);
      expect(saved.hasWdsfLicense).toBe(false);
      expect(saved.isStoreReview).toBe(false);
      expect(saved).toMatchObject({
        isLoggedIn: true,
        username: "b@club.fr",
        userId: "id-b",
        clubName: "Club B",
        role: "LICENSEE",
        appTheme: "dark",
        animationsEnabled: false,
        defaultLibraryFilter: "likes",
        defaultCompetitionScope: "registrant",
        defaultCompetitionStatus: "PAST",
      });
    });

    it("drops the previous account's files, reminders, favourites, presets, snapshot and queue", async () => {
      stored(LOGGED_OUT_A);
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expectPreviousAccountWiped();
    });

    it("purges the previous account's tokens and queue before writing the new tokens", async () => {
      const order: string[] = [];
      mockClearTokens.mockImplementationOnce(() => {
        order.push("clearTokens");
      });
      mockSetTokens.mockImplementationOnce(() => {
        order.push("setTokens");
      });
      stored(LOGGED_OUT_A);
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expect(order).toEqual(["clearTokens", "setTokens"]);
    });

    it("turns the biometric quick-login off: the new account never opted in", async () => {
      stored({ ...LOGGED_OUT_A, biometricsEnabled: true });
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expect(savedConfig().biometricsEnabled).toBe(false);
    });

    it("keeps the previous account's CGU acceptance: that account still exists", async () => {
      stored(LOGGED_OUT_A);
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expect(mockForgetCguAcceptance).not.toHaveBeenCalled();
    });

    it("is detected from the token a biometric lock retained", async () => {
      // logout() with biometrics: no userId, maybe no lastUserId (older
      // config), but the retained access token still names the account.
      stored({
        ...LOGGED_OUT_A,
        lastUserId: undefined,
        biometricsEnabled: true,
      });
      (getTokens as jest.Mock).mockResolvedValue({
        authToken: jwtFor("id-a"),
        refreshToken: "rt-a",
      });
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expectPreviousAccountWiped();
      expect(savedConfig().licensePhotoUri).toBeUndefined();
    });

    it("is detected while the previous account is still logged in", async () => {
      stored({
        ...LOGGED_OUT_A,
        isLoggedIn: true,
        username: "a@club.fr",
        userId: "id-a",
        lastUserId: undefined,
      });
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expectPreviousAccountWiped();
      expect(savedConfig().licensePhotoUri).toBeUndefined();
    });

    it("treats an unknown previous account as another one (conservative)", async () => {
      // Config written before #940 (no lastUserId), no retained token: the
      // e-mail alone does not prove the account is the same one (deleted and
      // re-created elsewhere…).
      stored({ ...LOGGED_OUT_A, lastUserId: undefined });
      respondWith(userA);

      await AuthService.login("a@club.fr", "pw");

      expectPreviousAccountWiped();
      expect(savedConfig().licensePhotoUri).toBeUndefined();
    });

    it("a newly registered account starts from the device preferences only", async () => {
      stored(LOGGED_OUT_A);
      respondWith({ ...userB, email: "new@club.fr", id: "id-new" });

      await AuthService.register(
        "new@club.fr",
        "Password1!",
        "123456",
        "Nouveau",
        "Compte",
      );

      const json = JSON.stringify(savedConfig());
      expect(json).not.toContain("file:///");
      expect(json).not.toContain("a@club.fr");
      expect(json).not.toContain("id-a");
      expectPreviousAccountWiped();
    });

    it("leaves nothing behind when the credentials are refused", async () => {
      stored(LOGGED_OUT_A);
      (api.post as jest.Mock).mockRejectedValueOnce(new Error("401"));

      await expect(AuthService.login("b@club.fr", "bad")).rejects.toThrow();

      expectNothingWiped();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it("still logs in when a file cleanup step fails", async () => {
      mockDeleteFavoriteDownloads.mockRejectedValueOnce(new Error("io"));
      mockDeleteAccountImages.mockRejectedValueOnce(new Error("io"));
      stored(LOGGED_OUT_A);
      respondWith(userB);

      await AuthService.login("b@club.fr", "pw");

      expect(mockClearCompetitionPresets).toHaveBeenCalledTimes(1);
      expect(savedConfig()).toMatchObject({
        isLoggedIn: true,
        userId: "id-b",
      });
      expect(savedConfig().licensePhotoUri).toBeUndefined();
    });
  });

  describe("the same account logs in again", () => {
    it("keeps its local settings after a plain logout", async () => {
      stored(LOGGED_OUT_A);
      respondWith(userA);

      await AuthService.login("a@club.fr", "pw");

      expect(savedConfig()).toMatchObject({
        ...A_LOCAL_SETTINGS,
        userId: "id-a",
        role: "LICENSEE",
      });
      expectNothingWiped();
    });

    it("keeps its local settings after a biometric lock (token retained)", async () => {
      stored({
        ...LOGGED_OUT_A,
        lastUserId: undefined,
        biometricsEnabled: true,
      });
      (getTokens as jest.Mock).mockResolvedValue({
        authToken: jwtFor("id-a"),
        refreshToken: "rt-a",
      });
      respondWith(userA);

      await AuthService.login("a@club.fr", "pw");

      expect(savedConfig()).toMatchObject({
        ...A_LOCAL_SETTINGS,
        biometricsEnabled: true,
      });
      expectNothingWiped();
    });
  });

  describe("logout", () => {
    it("remembers the account id for the next login", async () => {
      stored({
        ...LOGGED_OUT_A,
        isLoggedIn: true,
        username: "a@club.fr",
        userId: "id-a",
        lastUserId: undefined,
      });

      await AuthService.logout();

      expect(savedConfig()).toMatchObject({
        lastUser: "a@club.fr",
        lastUserId: "id-a",
      });
      expect(savedConfig().userId).toBeUndefined();
    });
  });
});
