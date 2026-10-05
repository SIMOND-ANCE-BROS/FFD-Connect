/**
 * Boot contract of the native entry file (index.js), #775: the Firebase
 * background message handler is registered at module scope, synchronously,
 * before the root component — and a build without Firebase still boots.
 *
 * The real backgroundMessaging / loadNotificationHandler run here; only the
 * Firebase-backed NotificationHandler and the heavy boot dependencies are
 * mocked, so the lazy guard itself is what is under test.
 */

const mockCalls: string[] = [];

const mockRegisterRootComponent = jest.fn(() => {
  mockCalls.push("registerRootComponent");
});

jest.mock("expo", () => ({
  registerRootComponent: (...args: unknown[]) =>
    mockRegisterRootComponent(...(args as [])),
}));
jest.mock("expo-updates", () => ({ runtimeVersion: "1.0.0", updateId: null }));
jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (app: unknown) => app,
}));
jest.mock("../polyfills", () => ({}));
jest.mock("../App", () => ({ __esModule: true, default: () => null }));

const mockHandler = {
  registerBackgroundMessageHandler: jest.fn(() => {
    mockCalls.push("registerBackgroundMessageHandler");
  }),
};

/** Flipped by the "no Firebase on this build" test. */
let mockHandlerUnavailable = false;

jest.mock("../src/features/settings/services/NotificationHandler", () => {
  if (mockHandlerUnavailable) {
    throw new Error("Native module RNFBMessaging not found");
  }
  return { notificationHandler: mockHandler };
});

const loadEntry = (): void => {
  jest.isolateModules(() => {
    require("../index");
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockHandlerUnavailable = false;
});

describe("index.js (native entry)", () => {
  it("registers the background handler at module load, before the root component", () => {
    loadEntry();

    expect(mockHandler.registerBackgroundMessageHandler).toHaveBeenCalledTimes(
      1,
    );
    expect(mockCalls).toEqual([
      "registerBackgroundMessageHandler",
      "registerRootComponent",
    ]);
  });

  it("still boots on a build without Firebase, without registering anything", () => {
    mockHandlerUnavailable = true;

    expect(loadEntry).not.toThrow();
    expect(mockHandler.registerBackgroundMessageHandler).not.toHaveBeenCalled();
    expect(mockRegisterRootComponent).toHaveBeenCalledTimes(1);
  });

  it("still boots when the native registration itself throws", () => {
    mockHandler.registerBackgroundMessageHandler.mockImplementationOnce(() => {
      throw new Error("native call failed");
    });

    expect(loadEntry).not.toThrow();
    expect(mockRegisterRootComponent).toHaveBeenCalledTimes(1);
  });
});
