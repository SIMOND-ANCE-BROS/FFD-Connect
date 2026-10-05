const {
  patchAppDelegate,
  TARGET_CALL,
} = require("../withFirebaseHeadlessLaunch");

/**
 * Verbatim excerpt of the AppDelegate emitted by `expo prebuild` on SDK 57,
 * including the FirebaseApp.configure() block that @react-native-firebase/app
 * injects just above the call — the patch must survive that neighbour.
 */
const EXPO_57_APP_DELEGATE = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
// @generated begin @react-native-firebase/app-didFinishLaunchingWithOptions - expo prebuild (DO NOT MODIFY)
FirebaseApp.configure()
// @generated end @react-native-firebase/app-didFinishLaunchingWithOptions
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

describe("withFirebaseHeadlessLaunch", () => {
  it("seeds isHeadless through the four-argument overload", () => {
    const patched = patchAppDelegate(EXPO_57_APP_DELEGATE, "swift");

    expect(patched).toContain(
      "initialProperties: RNFBMessagingModule.addCustomProps(toUserProps: nil, withLaunchOptions: launchOptions)",
    );
    // The launchOptions argument must survive: it is what tells RNFB the launch
    // came from a remote notification while backgrounded.
    expect(patched).toContain("launchOptions: launchOptions)");
  });

  it("is idempotent — prebuild runs repeatedly", () => {
    const once = patchAppDelegate(EXPO_57_APP_DELEGATE, "swift");
    const twice = patchAppDelegate(once, "swift");

    expect(twice).toBe(once);
    expect(twice.match(/addCustomProps\(toUserProps:/g)).toHaveLength(1);
  });

  it("throws when the Expo template no longer emits the call it patches", () => {
    // This is the regression that matters on an SDK upgrade: failing here, in
    // CI, costs nothing. Failing silently would ship a build that still mounts
    // the tree on a headless launch, discoverable only on a device.
    const drifted = EXPO_57_APP_DELEGATE.replace(
      TARGET_CALL,
      'factory.startReactNative(withModuleName: "main", in: window)',
    );

    expect(() => patchAppDelegate(drifted, "swift")).toThrow(
      /could not find the startReactNative call/,
    );
  });

  it("throws rather than silently skipping an Objective-C AppDelegate", () => {
    expect(() => patchAppDelegate(EXPO_57_APP_DELEGATE, "objc")).toThrow(
      /expected a Swift AppDelegate/,
    );
  });
});
