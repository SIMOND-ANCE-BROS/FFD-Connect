/**
 * pushRegistration loads ./NotificationHandler through a lazy `require` at call
 * time, not at module load. jest.isolateModules therefore cannot be used here —
 * it only isolates requires made inside its callback. Instead the handler is
 * mocked at the top level and the module under test is re-required after a
 * jest.resetModules() in beforeEach, so its module-scope listener guards start
 * fresh in every test.
 */

const mockRegister = jest.fn();
const mockUnregister = jest.fn();

jest.mock("../../../../api/generated", () => ({
  notificationsControllerRegisterDeviceToken: (...args: unknown[]) =>
    mockRegister(...args) as unknown,
  notificationsControllerUnregisterDeviceToken: (...args: unknown[]) =>
    mockUnregister(...args) as unknown,
}));

const mockGetAuthConfig = jest.fn();

jest.mock("../../../auth/services/AuthService", () => ({
  AuthService: { getAuthConfig: () => mockGetAuthConfig() as unknown },
}));

const mockHandler = {
  requestUserPermission: jest.fn(),
  getToken: jest.fn(),
  deleteToken: jest.fn(),
  onTokenRefresh: jest.fn(),
  setupNotificationListeners: jest.fn(),
};

/** Flipped by the "no Firebase on this build" tests. */
let mockHandlerUnavailable = false;

jest.mock("../NotificationHandler", () => {
  if (mockHandlerUnavailable) {
    // Mirrors a build whose Firebase plugins were never applied: the native
    // module is absent and loading the handler blows up.
    throw new Error("Native module RNFBMessaging not found");
  }
  return { notificationHandler: mockHandler };
});

type PushRegistration = typeof import("../pushRegistration");
let pushRegistration: PushRegistration;

beforeEach(() => {
  jest.clearAllMocks();
  mockHandlerUnavailable = false;

  mockRegister.mockResolvedValue({ data: undefined, error: undefined });
  mockUnregister.mockResolvedValue({ data: undefined, error: undefined });
  mockGetAuthConfig.mockResolvedValue({ impersonating: false });
  mockHandler.requestUserPermission.mockResolvedValue("fcm-token-1");
  mockHandler.getToken.mockResolvedValue("fcm-token-1");
  mockHandler.deleteToken.mockResolvedValue(undefined);
  mockHandler.onTokenRefresh.mockReturnValue(jest.fn());
  mockHandler.setupNotificationListeners.mockReturnValue(jest.fn());

  jest.resetModules();
  pushRegistration = require("../pushRegistration") as PushRegistration;
});

describe("registerDeviceTokenForPush", () => {
  it("sends the FCM token with the device platform", async () => {
    await pushRegistration.registerDeviceTokenForPush();

    expect(mockRegister).toHaveBeenCalledWith({
      body: { token: "fcm-token-1", platform: "IOS" },
    });
  });

  it("does nothing when the permission is refused", async () => {
    mockHandler.requestUserPermission.mockResolvedValue(undefined);

    await pushRegistration.registerDeviceTokenForPush();

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("stays silent on a build without Firebase instead of throwing", async () => {
    mockHandlerUnavailable = true;

    await expect(
      pushRegistration.registerDeviceTokenForPush(),
    ).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("swallows a backend failure so it cannot fail the login", async () => {
    mockRegister.mockResolvedValue({ error: { statusCode: 500 } });

    await expect(
      pushRegistration.registerDeviceTokenForPush(),
    ).resolves.toBeUndefined();
  });

  it("swallows a throwing permission request", async () => {
    mockHandler.requestUserPermission.mockRejectedValue(new Error("denied"));

    await expect(
      pushRegistration.registerDeviceTokenForPush(),
    ).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("re-sends the token when FCM rotates it", async () => {
    await pushRegistration.registerDeviceTokenForPush();

    const onRefresh = mockHandler.onTokenRefresh.mock.calls[0][0] as (
      token: string,
    ) => void;
    onRefresh("fcm-token-2");
    // The refresh handler is fire-and-forget and sendToken now awaits the auth
    // config first, so drain the microtask queue rather than a single tick.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRegister).toHaveBeenLastCalledWith({
      body: { token: "fcm-token-2", platform: "IOS" },
    });
  });

  it("does not re-attribute the admin's device during an impersonation", async () => {
    mockGetAuthConfig.mockResolvedValue({ impersonating: true });

    await pushRegistration.registerDeviceTokenForPush();

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("fails closed when the auth config cannot be read", async () => {
    mockGetAuthConfig.mockRejectedValue(new Error("storage unavailable"));

    await pushRegistration.registerDeviceTokenForPush();

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("subscribes to rotation once across repeated calls", async () => {
    await pushRegistration.registerDeviceTokenForPush();
    await pushRegistration.registerDeviceTokenForPush();

    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(mockHandler.onTokenRefresh).toHaveBeenCalledTimes(1);
  });

  it("claims the rotation subscription before awaiting, so concurrent calls cannot stack two", async () => {
    await Promise.all([
      pushRegistration.registerDeviceTokenForPush(),
      pushRegistration.registerDeviceTokenForPush(),
    ]);

    expect(mockHandler.onTokenRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterDeviceTokenForPush", () => {
  it("deletes the token and drops the rotation listener", async () => {
    const unsubscribe = jest.fn();
    mockHandler.onTokenRefresh.mockReturnValue(unsubscribe);

    await pushRegistration.registerDeviceTokenForPush();
    await pushRegistration.unregisterDeviceTokenForPush();

    expect(mockUnregister).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: "fcm-token-1" } }),
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // Coupe la livraison sans dépendre de l'aller-retour backend.
    expect(mockHandler.deleteToken).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there is no token", async () => {
    mockHandler.getToken.mockResolvedValue(undefined);

    await pushRegistration.unregisterDeviceTokenForPush();

    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it("gives up rather than holding the logout open when the call hangs", async () => {
    jest.useFakeTimers();
    try {
      // Un backend en cold start : la requête ne répond pas, seul l'abort la
      // termine — comme fetch, le mock rejette sur le signal.
      mockUnregister.mockImplementation(
        (options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );

      const pending = pushRegistration.unregisterDeviceTokenForPush();
      await jest.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toBeUndefined();

      // Le filet local doit avoir joué malgré l'annulation : sinon l'appareil
      // continuerait de recevoir les notifications de l'utilisateur précédent.
      expect(mockHandler.deleteToken).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stays silent on a build without Firebase", async () => {
    mockHandlerUnavailable = true;

    await expect(
      pushRegistration.unregisterDeviceTokenForPush(),
    ).resolves.toBeUndefined();
    expect(mockUnregister).not.toHaveBeenCalled();
  });
});

describe("setupPushListeners", () => {
  it("wires the message listeners once", () => {
    pushRegistration.setupPushListeners();
    pushRegistration.setupPushListeners();

    expect(mockHandler.setupNotificationListeners).toHaveBeenCalledTimes(1);
  });

  it("stays silent on a build without Firebase", () => {
    mockHandlerUnavailable = true;

    expect(() => {
      pushRegistration.setupPushListeners();
    }).not.toThrow();
    expect(mockHandler.setupNotificationListeners).not.toHaveBeenCalled();
  });
});
