console.log("DEBUG: TurboModuleRegistry mock loaded");
const TurboModuleRegistry = {
  getEnforcing: (name) => {
    if (name === "SourceCode") {
      return {
        getConstants: () => ({
          scriptURL: "http://localhost:8081/index.bundle",
        }),
      };
    }
    if (
      name === "PlatformConstants" ||
      name === "NativePlatformConstantsIOS" ||
      name === "NativePlatformConstantsAndroid"
    ) {
      return {
        getConstants: () => ({
          isTesting: true,
          reactNativeVersion: { major: 0, minor: 81, patch: 5 },
          osVersion: "17.0",
          systemName: "iOS",
          interfaceIdiom: "phone",
        }),
      };
    }
    if (name === "ReactDevToolsSettingsManager") {
      return {
        getGlobalHookSettings: jest.fn(() => ({})),
        setGlobalHookSettings: jest.fn(),
      };
    }
    if (name === "StatusBarManager") {
      return {
        getConstants: () => ({ HEIGHT: 44 }),
        setStyle: jest.fn(),
        setHidden: jest.fn(),
        setNetworkActivityIndicatorVisible: jest.fn(),
        getHeight: jest.fn(),
      };
    }
    if (name === "SettingsManager") {
      return {
        getConstants: () => ({ settings: {} }),
        setValues: jest.fn(),
        deleteValues: jest.fn(),
      };
    }
    if (name === "ReactDevToolsRuntimeSettingsModule") {
      return {
        setReloadAndProfileConfig: jest.fn(),
        getReloadAndProfileConfig: jest.fn(() => ({
          shouldReloadAndProfile: false,
          recordChangeDescriptions: false,
        })),
      };
    }
    if (name === "AppState") {
      return {
        getConstants: () => ({ initialAppState: "active" }),
        getCurrentAppState: jest.fn((cb) => cb({ app_state: "active" })),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      };
    }
    if (name === "DeviceInfo" || name === "NativeDeviceInfo") {
      const dims = { width: 375, height: 812, scale: 2, fontScale: 1 };
      return {
        getConstants: () => ({
          Dimensions: {
            window: dims,
            screen: dims,
          },
        }),
        getDimensions: jest.fn(() => dims),
      };
    }
    // Return a generic mock for others using Proxy to avoid "is not a function" errors
    return new Proxy(
      {
        getConstants: () => ({}),
        installWeb: jest.fn(),
      },
      {
        get: (target, prop) => {
          if (prop in target) {
            return target[prop];
          }
          return jest.fn();
        },
      },
    );
  },
  get: (name) => {
    if (name === "SourceCode") {
      return {
        getConstants: () => ({
          scriptURL: "http://localhost:8081/index.bundle",
        }),
      };
    }
    if (
      name === "PlatformConstants" ||
      name === "NativePlatformConstantsIOS" ||
      name === "NativePlatformConstantsAndroid"
    ) {
      return {
        getConstants: () => ({
          isTesting: true,
          reactNativeVersion: { major: 0, minor: 81, patch: 5 },
        }),
      };
    }
    if (name === "ReactDevToolsSettingsManager") {
      return {
        getGlobalHookSettings: jest.fn(() => ({})),
        setGlobalHookSettings: jest.fn(),
      };
    }
    if (name === "StatusBarManager") {
      return {
        getConstants: () => ({ HEIGHT: 44 }),
        setStyle: jest.fn(),
        setHidden: jest.fn(),
        setNetworkActivityIndicatorVisible: jest.fn(),
        getHeight: jest.fn(),
      };
    }
    if (name === "SettingsManager") {
      return {
        getConstants: () => ({ settings: {} }),
        setValues: jest.fn(),
        deleteValues: jest.fn(),
      };
    }
    if (name === "ReactDevToolsRuntimeSettingsModule") {
      return {
        setReloadAndProfileConfig: jest.fn(),
        getReloadAndProfileConfig: jest.fn(() => ({
          shouldReloadAndProfile: false,
          recordChangeDescriptions: false,
        })),
      };
    }
    if (name === "AppState") {
      return {
        getConstants: () => ({ initialAppState: "active" }),
        getCurrentAppState: jest.fn((cb) => cb({ app_state: "active" })),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      };
    }
    if (name === "DeviceInfo" || name === "NativeDeviceInfo") {
      const dims = { width: 375, height: 812, scale: 2, fontScale: 1 };
      return {
        getConstants: () => ({
          Dimensions: {
            window: dims,
            screen: dims,
          },
        }),
        getDimensions: jest.fn(() => dims),
      };
    }
    // Return a generic mock for others using Proxy to avoid "is not a function" errors
    return new Proxy(
      {
        getConstants: () => ({}),
        installWeb: jest.fn(),
      },
      {
        get: (target, prop) => {
          if (prop in target) {
            return target[prop];
          }
          return jest.fn();
        },
      },
    );
  },
};

module.exports = TurboModuleRegistry;
