/**
 * Server-side revocation of the refresh token a session end drops (#942).
 * A full logout (no biometrics) and a login replacing the previous session's
 * token revoke it through POST /auth/logout, best-effort: the request never
 * delays nor fails the local logout. The Face ID / Touch ID lock keeps the
 * token for the same account's biometric unlock and revokes nothing.
 *
 * The real revocation module runs here; only the generated client is mocked.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import api from "../../../../services/api";
import { getTokens } from "../../../../api/tokenStore";
import { AuthService, DEFAULT_CONFIG } from "../AuthService";

const mockLogoutRequest = jest.fn();
const mockClearTokens = jest.fn();
const mockSetTokens = jest.fn();
const mockUnregisterPush = jest.fn();
const mockBackupRefresh = jest.fn();
const order: string[] = [];

jest.mock("../../../../api/generated", () => ({
  authControllerLogout: (options: unknown) => mockLogoutRequest(options),
}));

jest.mock("../../../../utils/backendWake", () => ({
  rawFetch: () => jest.fn(),
}));

jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: jest.fn(),
  unregisterDeviceTokenForPush: () => mockUnregisterPush() as unknown,
  deleteLocalPushToken: jest.fn(async () => {}),
}));

jest.mock("../../../../services/sessionCleanup", () => ({
  runSessionEndCleanups: jest.fn(async () => {}),
}));

jest.mock("../../../license/utils/licenseSnapshot", () => ({
  clearLicenseSnapshot: jest.fn(async () => {}),
}));

jest.mock("../../../../utils/scheduleDeadlineNotification", () => ({
  clearAllDeadlineReminders: jest.fn(async () => {}),
}));

jest.mock("../../../player/services/TrackOfflineService", () => ({
  deleteFavoriteDownloads: jest.fn(async () => {}),
}));

jest.mock("../../../settings/services/accountImages", () => ({
  deleteAccountImages: jest.fn(async () => {}),
}));

jest.mock("../../../../stores/competitionPresets.store", () => ({
  clearCompetitionPresets: jest.fn(async () => {}),
}));

jest.mock("../../../../api/tokenStore", () => ({
  clearTokens: () => mockClearTokens() as unknown,
  getTokens: jest.fn(async () => ({})),
  setTokens: (t: unknown) => mockSetTokens(t) as unknown,
  getImpersonationBackupRefreshToken: () => mockBackupRefresh() as unknown,
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

/** An unsigned JWT naming `sub`: only its payload is ever read. */
const jwtFor = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

/** auth_config in AsyncStorage + the tokens in the token store. */
function device(
  prefs: object,
  tokens: { authToken?: string; refreshToken?: string } = {},
  backup?: object,
) {
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(
      key === "auth_config"
        ? JSON.stringify({ ...DEFAULT_CONFIG, ...prefs })
        : key === "impersonation_backup" && backup
          ? JSON.stringify(backup)
          : null,
    ),
  );
  (getTokens as jest.Mock).mockResolvedValue(tokens);
}

const revokedTokens = () =>
  mockLogoutRequest.mock.calls.map(
    ([options]) =>
      (options as { body: { refresh_token: string } }).body.refresh_token,
  );

function loginResponse(user: object, refresh = "new-refresh") {
  (api.post as jest.Mock).mockResolvedValue({
    data: { access_token: "new-access", refresh_token: refresh, user },
  });
}

const A_ACCESS = jwtFor("id-a");
const userA = { id: "id-a", email: "a@club.fr", role: "LICENSEE" };
const userB = { id: "id-b", email: "b@club.fr", role: "LICENSEE" };

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  mockLogoutRequest.mockImplementation(() => {
    order.push("revoke");
    return Promise.resolve({ data: { success: true }, error: undefined });
  });
  mockClearTokens.mockImplementation(async () => {
    order.push("clearTokens");
  });
  mockSetTokens.mockImplementation(async () => {
    order.push("setTokens");
  });
  mockUnregisterPush.mockResolvedValue(undefined);
  mockBackupRefresh.mockResolvedValue(undefined);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (api.post as jest.Mock).mockResolvedValue({ data: {} });
});

describe("logout (#942)", () => {
  const loggedInA = { isLoggedIn: true, userId: "id-a", username: "a@club.fr" };

  it("sends the refresh token to /auth/logout before clearTokens", async () => {
    device(loggedInA, { authToken: A_ACCESS, refreshToken: "refresh-a" });

    await AuthService.logout();

    expect(revokedTokens()).toEqual(["refresh-a"]);
    expect(order).toEqual(["revoke", "clearTokens"]);
  });

  it("never waits for the server: a hanging request does not hold the logout", async () => {
    mockLogoutRequest.mockReturnValue(new Promise(() => undefined));
    device(loggedInA, { authToken: A_ACCESS, refreshToken: "refresh-a" });

    await AuthService.logout();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"isLoggedIn":false'),
    );
  });

  it.each([
    ["a rejected request", () => Promise.reject(new Error("offline"))],
    [
      "an error answer",
      () => Promise.resolve({ data: undefined, error: { message: "401" } }),
    ],
    [
      "a synchronous throw",
      () => {
        throw new Error("boom");
      },
    ],
  ])("still logs out locally after %s", async (_label, behaviour) => {
    mockLogoutRequest.mockImplementation(behaviour);
    device(loggedInA, { authToken: A_ACCESS, refreshToken: "refresh-a" });

    await AuthService.logout();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "auth_config",
      expect.stringContaining('"isLoggedIn":false'),
    );
  });

  it("revokes nothing on the Face ID / Touch ID lock (same account unlocks)", async () => {
    device(
      { ...loggedInA, biometricsEnabled: true },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );

    await AuthService.logout();

    expect(mockLogoutRequest).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it("sends nothing when no refresh token is held", async () => {
    device(loggedInA, {});

    await AuthService.logout();

    expect(mockLogoutRequest).not.toHaveBeenCalled();
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  it("during a support access, revokes the admin's set-aside refresh token", async () => {
    mockBackupRefresh.mockResolvedValue("admin-refresh");
    device(
      { isLoggedIn: true, impersonating: true, username: "t@club.fr" },
      { authToken: "target-access" },
      { isLoggedIn: true, username: "admin@ffd.fr", role: "ADMIN" },
    );

    await AuthService.logout();

    expect(revokedTokens()).toEqual(["admin-refresh"]);
  });

  it("during a support access, an unreadable backup does not stop the logout", async () => {
    mockBackupRefresh.mockRejectedValue(new Error("locked"));
    device(
      { isLoggedIn: true, impersonating: true, username: "t@club.fr" },
      { authToken: "target-access" },
    );

    await AuthService.logout();

    expect(mockLogoutRequest).not.toHaveBeenCalled();
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });
});

describe("login replacing the previous session's token (#942)", () => {
  it("revokes the token a biometric lock kept when another account logs in", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );
    loginResponse(userB);

    await AuthService.login("b@club.fr", "pw");

    expect(revokedTokens()).toEqual(["refresh-a"]);
    expect(order).toEqual(["clearTokens", "setTokens", "revoke"]);
  });

  it("revokes the token a biometric lock kept when the same account logs in with its password", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );
    loginResponse(userA);

    await AuthService.login("a@club.fr", "pw");

    expect(revokedTokens()).toEqual(["refresh-a"]);
    expect(order).toEqual(["setTokens", "revoke"]);
  });

  it("revokes nothing after a plain logout (no token left)", async () => {
    device({ isLoggedIn: false, lastUserId: "id-a" }, {});
    loginResponse(userA);

    await AuthService.login("a@club.fr", "pw");

    expect(mockLogoutRequest).not.toHaveBeenCalled();
  });

  it("revokes nothing when the login is refused", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );
    (api.post as jest.Mock).mockRejectedValue(new Error("401"));

    await expect(AuthService.login("a@club.fr", "bad")).rejects.toThrow();

    expect(mockLogoutRequest).not.toHaveBeenCalled();
  });

  it("revokes nothing when the new tokens cannot be stored (the kept ones still unlock)", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );
    loginResponse(userA);
    mockSetTokens.mockRejectedValue(new Error("keychain locked"));

    await expect(AuthService.login("a@club.fr", "pw")).rejects.toThrow();

    expect(mockLogoutRequest).not.toHaveBeenCalled();
  });

  it("never revokes the token the server just issued", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "same-refresh" },
    );
    loginResponse(userA, "same-refresh");

    await AuthService.login("a@club.fr", "pw");

    expect(mockLogoutRequest).not.toHaveBeenCalled();
  });

  it("register revokes the token a biometric lock kept", async () => {
    device(
      { isLoggedIn: false, biometricsEnabled: true, lastUserId: "id-a" },
      { authToken: A_ACCESS, refreshToken: "refresh-a" },
    );
    loginResponse(userB);

    await AuthService.register("b@club.fr", "pw", "123", "B", "Bob");

    expect(revokedTokens()).toEqual(["refresh-a"]);
  });
});
