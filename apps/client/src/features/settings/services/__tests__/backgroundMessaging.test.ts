/**
 * backgroundMessaging loads ./NotificationHandler lazily through
 * loadNotificationHandler, and keeps a module-scope "registered" guard. The
 * handler is mocked at the top level and the module under test re-required
 * after jest.resetModules() so every test starts from a fresh guard.
 */
import { Platform } from "react-native";

const mockHandler = {
  registerBackgroundMessageHandler: jest.fn(),
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

type BackgroundMessaging = typeof import("../backgroundMessaging");
let backgroundMessaging: BackgroundMessaging;

const originalOS = Platform.OS;

const setOS = (os: typeof Platform.OS): void => {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHandlerUnavailable = false;
  mockHandler.registerBackgroundMessageHandler.mockImplementation(() => {});
  jest.resetModules();
  backgroundMessaging =
    require("../backgroundMessaging") as BackgroundMessaging;
});

afterEach(() => {
  setOS(originalOS);
});

describe("registerBackgroundMessageHandler", () => {
  it("registers the handler synchronously when Firebase is present", () => {
    expect(backgroundMessaging.registerBackgroundMessageHandler()).toBe(true);
    expect(mockHandler.registerBackgroundMessageHandler).toHaveBeenCalledTimes(
      1,
    );
  });

  it("registers only once across repeated calls", () => {
    backgroundMessaging.registerBackgroundMessageHandler();
    expect(backgroundMessaging.registerBackgroundMessageHandler()).toBe(true);

    expect(mockHandler.registerBackgroundMessageHandler).toHaveBeenCalledTimes(
      1,
    );
  });

  it("is a silent no-op on a build without Firebase", () => {
    mockHandlerUnavailable = true;

    let result: boolean | undefined;
    expect(() => {
      result = backgroundMessaging.registerBackgroundMessageHandler();
    }).not.toThrow();
    expect(result).toBe(false);
    expect(mockHandler.registerBackgroundMessageHandler).not.toHaveBeenCalled();
  });

  it("swallows a throwing registration and allows a later retry", () => {
    mockHandler.registerBackgroundMessageHandler.mockImplementationOnce(() => {
      throw new Error("native call failed");
    });

    expect(backgroundMessaging.registerBackgroundMessageHandler()).toBe(false);
    // Not marked as registered, so a later call can still succeed.
    expect(backgroundMessaging.registerBackgroundMessageHandler()).toBe(true);
    expect(mockHandler.registerBackgroundMessageHandler).toHaveBeenCalledTimes(
      2,
    );
  });

  it("does nothing off native platforms", () => {
    setOS("web");

    expect(backgroundMessaging.registerBackgroundMessageHandler()).toBe(false);
    expect(mockHandler.registerBackgroundMessageHandler).not.toHaveBeenCalled();
  });
});
