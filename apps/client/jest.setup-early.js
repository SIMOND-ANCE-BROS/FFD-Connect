// This file must run BEFORE 'react-native' is imported.
// It patches global variables that recent RN versions expect to be present.

// Polyfill setImmediate for libraries that depend on it
if (typeof global.setImmediate === "undefined") {
  const setImmediatePolyfill = (fn) => setTimeout(fn, 0);
  global.setImmediate = setImmediatePolyfill;
  globalThis.setImmediate = setImmediatePolyfill;
}
if (typeof global.clearImmediate === "undefined") {
  const clearImmediatePolyfill = (id) => clearTimeout(id);
  global.clearImmediate = clearImmediatePolyfill;
  globalThis.clearImmediate = clearImmediatePolyfill;
}

global.__fbBatchedBridgeConfig = {
  remoteModuleConfig: [],
  localModulesConfig: [],
};

global.__turboModuleProxy = (name) => {
  if (name === "SourceCode") {
    return {
      getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle" }),
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
  if (name === "NativeDevSettings" || name === "DevSettings") {
    return {
      addMenuItem: jest.fn(),
      reload: jest.fn(),
      onFastRefresh: jest.fn(),
      setHotloadingEnabled: jest.fn(),
      setIsDebuggingRemotely: jest.fn(),
      setProfilingEnabled: jest.fn(),
      toggleElementInspector: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  }
  if (name === "NativeAnimatedModule" || name === "NativeAnimatedTurboModule") {
    return {
      createAnimatedNode: jest.fn(),
      startListeningConfigurableProps: jest.fn(),
      stopListeningConfigurableProps: jest.fn(),
      connectAnimatedNodes: jest.fn(),
      disconnectAnimatedNodes: jest.fn(),
      startAnimatingNode: jest.fn(),
      stopAnimation: jest.fn(),
      setAnimatedNodeValue: jest.fn(),
      setAnimatedNodeOffset: jest.fn(),
      flattenAnimatedNodeOffset: jest.fn(),
      extractAnimatedNodeOffset: jest.fn(),
      connectAnimatedNodeToView: jest.fn(),
      disconnectAnimatedNodeFromView: jest.fn(),
      restoreDefaultValues: jest.fn(),
      dropAnimatedNode: jest.fn(),
      addAnimatedEventToView: jest.fn(),
      removeAnimatedEventFromView: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  }
  if (name === "ReactDevToolsSettingsManager") {
    return {
      getGlobalHookSettings: jest.fn(() => ({})),
      setGlobalHookSettings: jest.fn(),
    };
  }
  return null;
};

// Also mock NativeModules.SourceCode for compatibility
global.NativeModules = global.NativeModules || {};
global.NativeModules.SourceCode = global.NativeModules.SourceCode || {
  getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle" }),
};

// FIX: Mock BatchedBridge EARLY to prevent JSTimers crash during RN init
// This is critical for RN 0.74+ / 0.81+ in Jest environment
jest.mock("react-native/Libraries/BatchedBridge/BatchedBridge", () => ({
  registerCallableModule: jest.fn(),
  registerLazyCallableModule: jest.fn(),
  setReactNativeMicrotasksCallback: jest.fn(),
  createDebugLookup: jest.fn(),
  callFunctionReturnFlushedQueue: jest.fn(),
}));

// FIX: Mock NativeModules early to satisfy jest-expo setup if present
// Mock @sentry/react-native BEFORE any component imports it (e.g. App.tsx)
jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  wrap: (fn) => fn,
  withScope: jest.fn(
    (cb) => cb && cb({ setTag: jest.fn(), setExtra: jest.fn() }),
  ),
  Severity: { Error: "error", Warning: "warning", Info: "info" },
  React: { ErrorBoundary: ({ children }) => children },
  ReactNavigationInstrumentation: jest.fn(),
  nativeCrash: jest.fn(),
}));

jest.mock(
  "react-native/Libraries/BatchedBridge/NativeModules",
  () => ({
    UIManager: {},
    NativeUnimoduleProxy: {
      viewManagersMetadata: {},
    },
    // Add other required modules if needed
  }),
  { virtual: true },
);
