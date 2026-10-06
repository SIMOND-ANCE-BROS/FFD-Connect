// Mocks MUST be defined before any require/import that matches them
// babel-jest hoists jest.mock, but side-effect imports might still be tricky.
// We use require for side-effects to be sure.

console.log("Jest Setup Running: Injecting Globals");

global.IS_REACT_ACT_ENVIRONMENT = true;

// EARLY PATCH: Define __fbBatchedBridgeConfig before any RN code runs
global.__fbBatchedBridgeConfig = {
  remoteModuleConfig: [],
  localModulesConfig: [],
};

// Polyfill for NativeModules if missing
if (!global.nativeFabricUIManager) {
  global.nativeFabricUIManager = {
    getInspectorDataForViewTag: jest.fn(),
  };
}

if (!global.RN$Bridgeless) {
  global.RN$Bridgeless = false;
}

global.__turboModuleProxy = jest.fn();

// global.React = require('react'); // Removed to prevent multiple React instances

jest.mock("react-native/Libraries/Core/setUpReactDevTools", () => jest.fn());

// --- MOCKS START ---

// Correctly mock Dimensions default export to bypass top-level execution
jest.mock("react-native/Libraries/Utilities/Dimensions", () => {
  const dims = { width: 375, height: 812, scale: 2, fontScale: 1 };
  return {
    __esModule: true,
    default: {
      get: jest.fn().mockReturnValue(dims),
      set: jest.fn(),
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
      removeEventListener: jest.fn(),
    },
    // Adding named exports for newer RN/TurboModule versions
    get: jest.fn().mockReturnValue(dims),
    set: jest.fn(),
  };
});

jest.mock("react-native/Libraries/Utilities/PixelRatio", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => 2),
    getFontScale: jest.fn(() => 1),
    getPixelSizeForLayoutSize: jest.fn((size) => size * 2),
    roundToNearestPixel: jest.fn((size) => size),
  },
  get: jest.fn(() => 2),
  getFontScale: jest.fn(() => 1),
  getPixelSizeForLayoutSize: jest.fn((size) => size * 2),
  roundToNearestPixel: jest.fn((size) => size),
}));

jest.mock("react-native/Libraries/Utilities/Appearance", () => ({
  getColorScheme: jest.fn(),
  addChangeListener: jest.fn(),
  removeChangeListener: jest.fn(),
}));

jest.mock("react-native/Libraries/Settings/Settings", () => ({
  get: jest.fn(),
  set: jest.fn(),
  watchKeys: jest.fn(),
  clearWatch: jest.fn(),
}));

// Fix for NativeModules crashes
// We rely on the preset's NativeModules mock now, plus our global patch.
// If specific modules are missing, we mock them individually.

jest.mock("react-native/Libraries/BatchedBridge/BatchedBridge", () => ({
  registerCallableModule: jest.fn(),
  registerLazyCallableModule: jest.fn(),
  setReactNativeMicrotasksCallback: jest.fn(),
}));

jest.mock("expo-modules-core", () => ({
  NativeModulesProxy: {},
  EventEmitter: jest.fn(),
  requireNativeViewManager: jest.fn(() => () => null),
  requireOptionalNativeModule: jest.fn(() => null),
  requireNativeModule: jest.fn(() => null),
}));

// Mock expo-image pour éviter les modules natifs dans les tests (LoginScreen, LicenseCard)
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return {
    Image: View,
    ImageSource: {},
  };
});

jest.mock(
  "react-native/src/private/specs_DEPRECATED/modules/NativeBlobModule",
  () => ({
    __esModule: true,
    default: {
      addNetworkingHandler: jest.fn(),
      addWebSocketHandler: jest.fn(),
      removeWebSocketHandler: jest.fn(),
      createFromParts: jest.fn(),
      release: jest.fn(),
    },
  }),
  { virtual: true },
);

// Mock internal NativeSourceCode to bypass TurboModuleRegistry check in RN 0.81+
// This path is specific to the version of RN identified in stack traces
jest.mock(
  "react-native/src/private/specs_DEPRECATED/modules/NativeSourceCode",
  () => ({
    __esModule: true,
    default: {
      getConstants: () => ({ scriptURL: null }),
    },
  }),
  { virtual: true },
);

// Polyfill window
if (typeof window !== "undefined" && !window.dispatchEvent) {
  window.dispatchEvent = jest.fn();
}

/**
 * Console configuration
 */
const setupConsole = require("../../packages/jest-config/setup/console");

setupConsole([
  "Checkin Error",
  "TTS Download Error",
  "Network Error",
  "API Error",
  "Error fetching tracks",
  "Error sending message",
  "OCR failed",
  "WDSF API Error",
  "Failed to initialize Firebase",
]);

// --- OTHER MOCKS (Preserved) ---

jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: {
      View: View,
      Text: View,
      createAnimatedComponent: (component) => component,
    },
    useSharedValue: jest.fn((v) => ({ value: v })),
    useAnimatedStyle: (updater) => updater(),
    useEvent: jest.fn(),
    useHandler: jest.fn(),
    useAnimatedGestureHandler: jest.fn(),
    useAnimatedScrollHandler: jest.fn(),
    useDerivedValue: jest.fn((fn) => ({ value: fn() })),
    withSpring: jest.fn((v) => v),
    withTiming: jest.fn((v) => v),
    runOnJS: jest.fn((fn) => fn),
    FadeIn: { duration: jest.fn(() => ({})) },
    FadeOut: { duration: jest.fn(() => ({})) },
    LinearTransition: { springify: jest.fn(() => ({})) },
    Layout: {},
    SlideInDown: {},
    SlideOutUp: {},
    Extrapolation: {
      CLAMP: "clamp",
      IDENTITY: "identity",
      EXTEND: "extend",
    },
    interpolate: jest.fn((value, inputRange, outputRange) => outputRange[0]),
  };
});

// AsyncStorage v3 ships a real in-memory mock (jest/AsyncStorageMock) instead of jest.fn() stubs.
// Tests cast methods as jest.Mock, so we provide jest.fn() wrappers backed by a real store.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => store.get(key) ?? null),
      setItem: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      getAllKeys: jest.fn(async () => [...store.keys()]),
      multiGet: jest.fn(async (keys) =>
        keys.map((k) => [k, store.get(k) ?? null]),
      ),
      multiSet: jest.fn(async (pairs) => {
        pairs.forEach(([k, v]) => store.set(k, v));
      }),
      multiRemove: jest.fn(async (keys) => {
        keys.forEach((k) => store.delete(k));
      }),
      mergeItem: jest.fn(async (key, value) => {
        const existing = store.get(key);
        if (existing) {
          const merged = JSON.stringify({
            ...JSON.parse(existing),
            ...JSON.parse(value),
          });
          store.set(key, merged);
        } else {
          store.set(key, value);
        }
      }),
      multiMerge: jest.fn(),
      flushGetRequests: jest.fn(),
    },
  };
});

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

// react-native-share mock removed

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children, ...props }) => {
    const { View } = require("react-native");
    return <View {...props}>{children}</View>;
  },
}));

jest.mock("@env", () => ({ API_URL: "http://localhost:3000" }), {
  virtual: true,
});

// Audio engine is expo-audio (see src/utils/TrackPlayerWrapper.ts). Mock the
// native module with a controllable fake player.
jest.mock("expo-audio", () => {
  const makePlayer = () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    setPlaybackRate: jest.fn(),
    replace: jest.fn(),
    remove: jest.fn(),
    release: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    updateLockScreenMetadata: jest.fn(),
    clearLockScreenControls: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    volume: 1,
    playbackRate: 1,
    currentTime: 0,
    duration: 0,
    playing: false,
    paused: true,
    isLoaded: false,
    loop: false,
    currentStatus: {
      isLoaded: false,
      playing: false,
      currentTime: 0,
      duration: 0,
      didJustFinish: false,
      isBuffering: false,
    },
  });
  return {
    createAudioPlayer: jest.fn(() => makePlayer()),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    useAudioPlayer: jest.fn(() => makePlayer()),
    useAudioPlayerStatus: jest.fn(() => ({ isLoaded: false, playing: false })),
  };
});

jest.mock("react-native-google-places-autocomplete", () => ({
  GooglePlacesAutocomplete: () => null,
}));

jest.mock("react-native-draggable-flatlist", () => ({
  __esModule: true,
  default: (props) => <props.ListHeaderComponent />,
  ScaleDecorator: ({ children }) => children,
  ShadowDecorator: ({ children }) => children,
  OpacityDecorator: ({ children }) => children,
  useOnCellActiveAnimation: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => {
  const Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: jest.fn(() => Insets),
    useSafeAreaFrame: jest.fn(() => ({ x: 0, y: 0, width: 390, height: 844 })),
    withSafeAreaInsets: (Component) => (props) => (
      <Component {...props} insets={Insets} />
    ),
  };
});

jest.mock("react-native-svg", () => ({
  __esModule: true,
  default: "Svg",
  Circle: "Circle",
  Rect: "Rect",
  Polygon: "Polygon",
  Path: "Path",
  Defs: "Defs",
  Stop: "Stop",
  G: "G",
  LinearGradient: "LinearGradient",
  Use: "Use",
  Image: "Image",
  Symbol: "Symbol",
  Mask: "Mask",
  Pattern: "Pattern",
  ClipPath: "ClipPath",
  Text: "Text",
  TSpan: "TSpan",
  TextPath: "TextPath",
  Marker: "Marker",
  SvgUri: "SvgUri",
}));

jest.mock("react-native-qrcode-svg", () => "QRCode");

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(""),
}));

jest.mock(
  "lucide-react-native",
  () => new Proxy({}, { get: (_, property) => property }),
);

jest.mock("react-native-screens", () => ({
  enableScreens: jest.fn(),
}));

jest.mock("react-native/Libraries/Components/StatusBar/StatusBar", () => {
  const StatusBar = () => null;
  StatusBar.setBarStyle = jest.fn();
  StatusBar.setBackgroundColor = jest.fn();
  StatusBar.setTranslucent = jest.fn();
  StatusBar.setHidden = jest.fn();
  StatusBar.setNetworkActivityIndicatorVisible = jest.fn();
  StatusBar.currentHeight = 44;
  return {
    __esModule: true,
    default: StatusBar,
  };
});

jest.mock("expo-blur", () => ({
  BlurView: "BlurView",
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "1.0.0",
      ios: { buildNumber: "1" },
      android: { versionCode: 1 },
      runtimeVersion: "2.0.0",
    },
    nativeBuildVersion: "1",
    nativeAppVersion: "1.0.0",
  },
}));

jest.mock("expo-application", () => ({
  __esModule: true,
  applicationId: "fr.ffdanse.connect.dev",
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "85",
}));

jest.mock("expo-updates", () => ({
  __esModule: true,
  isEnabled: false,
  isEmbeddedLaunch: true,
  updateId: null,
  channel: null,
  runtimeVersion: "2.2.0",
  createdAt: null,
}));

jest.mock("expo-device", () => ({
  __esModule: true,
  osVersion: "18.0",
  modelName: "iPhone Test",
  isDevice: true,
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: "denied" }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 0, longitude: 0 },
  }),
  Accuracy: {
    Lowest: 1,
    Low: 2,
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  },
}));

jest.mock("expo-calendar", () => ({
  requestCalendarPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: "denied" }),
  getCalendarsAsync: jest.fn().mockResolvedValue([]),
  createEventAsync: jest.fn().mockResolvedValue("event-id"),
  EntityTypes: { EVENT: "event" },
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("notif-id"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 0 },
}));

jest.mock("@react-native-community/slider", () => "Slider");

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(() => Promise.resolve(false)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(false)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false })),
}));

// --- SIDE EFFECTS (Require at end) ---
jest.mock("react-native-gesture-handler", () => {
  const { View, TouchableOpacity } = require("react-native");
  return {
    GestureDetector: ({ children }) => children,
    Gesture: {
      Pan: () => ({
        enabled: jest.fn().mockReturnThis(),
        activeOffsetX: jest.fn().mockReturnThis(),
        activeOffsetY: jest.fn().mockReturnThis(),
        failOffsetX: jest.fn().mockReturnThis(),
        failOffsetY: jest.fn().mockReturnThis(),
        onBegin: jest.fn().mockReturnThis(),
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
        runOnJS: jest.fn().mockReturnThis(),
      }),
      Tap: () => ({
        enabled: jest.fn().mockReturnThis(),
        activeOffsetX: jest.fn().mockReturnThis(),
        activeOffsetY: jest.fn().mockReturnThis(),
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
        runOnJS: jest.fn().mockReturnThis(),
      }),
      Race: (...gestures) => gestures,
      Simultaneous: (...gestures) => gestures,
      Exclusive: (...gestures) => gestures,
    },
    GestureHandlerRootView: View,
    State: {},
    PanGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    ForceTouchGestureHandler: View,
    LongPressGestureHandler: View,
    PinchGestureHandler: View,
    RotationGestureHandler: View,
    RawButton: View,
    BaseButton: View,
    RectButton: View,
    BorderlessButton: View,
    NativeViewGestureHandler: View,
    TouchableOpacity: TouchableOpacity,
    DrawerLayout: View,
    ScrollView: View,
    Switch: View,
    TextInput: View,
    ToolbarAndroid: View,
    FlatList: View,
  };
});
// require('react-native-gesture-handler/jestSetup');

// react-native-keyboard-controller ships an official Jest mock (KeyboardProvider,
// KeyboardToolbar, hooks…). Without it, importing the module pulls reanimated
// Easing.bezier at load time and the whole suite fails to run.
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);
