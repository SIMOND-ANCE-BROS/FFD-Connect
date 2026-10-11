/**
 * Expo config plugin: withAndroidFreeOrientation
 * ==============================================
 *
 * Lifts the portrait lock on ANDROID ONLY, leaving iOS untouched.
 *
 * WHY
 *   Google Play flags apps that restrict orientation or resizability: from
 *   Android 16 (API 36) the system ignores `android:screenOrientation`,
 *   `android:resizeableActivity` and aspect-ratio limits on large screens
 *   (tablets, foldables, desktop windows). Shipping them anyway earns a
 *   "large screen" warning in the Play Console and a layout that Android
 *   overrides without asking.
 *
 * WHY A PLUGIN AND NOT `orientation` IN app.config.js
 *   The top-level `orientation: "portrait"` drives both platforms. iOS keeps
 *   its portrait-only behaviour (UISupportedInterfaceOrientations), so the key
 *   stays; this plugin only strips what it generated on Android.
 *
 * WHAT IT DOES
 *   On every <activity> of AndroidManifest.xml (in practice: MainActivity),
 *   removes `android:screenOrientation`, `android:resizeableActivity`,
 *   `android:maxAspectRatio` and `android:minAspectRatio`, and does the same
 *   on <application> for the attributes that can live there.
 *   MainActivity already declares `orientation|screenSize|screenLayout` in
 *   configChanges, so a rotation does not recreate the activity.
 *
 *   Library activities are merged in by Gradle AFTER prebuild, so they cannot
 *   be edited here. For those that lock the orientation (found in the merged
 *   release manifest), the plugin declares an override node carrying
 *   `tools:remove="android:screenOrientation"`, which the manifest merger
 *   applies. Today: the ML Kit code-scanner delegate pulled in by expo-camera
 *   (the app does not use that scanner — ScannerScreen uses CameraView).
 */

const { withAndroidManifest } = require("expo/config-plugins");

const TOOLS_NAMESPACE = "http://schemas.android.com/tools";

/** Library activities that declare a portrait lock in their own manifest. */
const LIBRARY_ACTIVITIES_LOCKING_ORIENTATION = [
  "com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity",
];

const RESTRICTING_ATTRIBUTES = [
  "android:screenOrientation",
  "android:resizeableActivity",
  "android:maxAspectRatio",
  "android:minAspectRatio",
];

function stripRestrictions(node) {
  if (!node || !node.$) return;
  for (const attribute of RESTRICTING_ATTRIBUTES) {
    delete node.$[attribute];
  }
}

/**
 * Removes the orientation / resizability restrictions from a parsed
 * AndroidManifest (xml2js shape, as handed by `withAndroidManifest`).
 * Mutates and returns the manifest.
 */
function removeOrientationRestrictions(manifest) {
  const applications = manifest?.manifest?.application ?? [];
  for (const application of applications) {
    stripRestrictions(application);
    for (const activity of application.activity ?? []) {
      stripRestrictions(activity);
    }
  }
  return manifest;
}

/**
 * Adds, once, an override node per library activity so the Gradle manifest
 * merger drops their `android:screenOrientation`. Mutates and returns the
 * manifest.
 */
function overrideLibraryActivities(manifest) {
  const root = manifest?.manifest;
  const application = root?.application?.[0];
  if (!root || !application) return manifest;

  root.$ = { ...root.$, "xmlns:tools": TOOLS_NAMESPACE };
  application.activity = application.activity ?? [];
  for (const name of LIBRARY_ACTIVITIES_LOCKING_ORIENTATION) {
    const existing = application.activity.find(
      (activity) => activity.$?.["android:name"] === name,
    );
    if (existing) {
      existing.$["tools:remove"] = "android:screenOrientation";
    } else {
      application.activity.push({
        $: {
          "android:name": name,
          "tools:remove": "android:screenOrientation",
        },
      });
    }
  }
  return manifest;
}

function withAndroidFreeOrientation(config) {
  return withAndroidManifest(config, (modConfig) => {
    removeOrientationRestrictions(modConfig.modResults);
    overrideLibraryActivities(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidFreeOrientation;
module.exports.removeOrientationRestrictions = removeOrientationRestrictions;
module.exports.overrideLibraryActivities = overrideLibraryActivities;
module.exports.LIBRARY_ACTIVITIES_LOCKING_ORIENTATION =
  LIBRARY_ACTIVITIES_LOCKING_ORIENTATION;
module.exports.RESTRICTING_ATTRIBUTES = RESTRICTING_ATTRIBUTES;
