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
 */

const { withAndroidManifest } = require("expo/config-plugins");

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

function withAndroidFreeOrientation(config) {
  return withAndroidManifest(config, (modConfig) => {
    removeOrientationRestrictions(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidFreeOrientation;
module.exports.removeOrientationRestrictions = removeOrientationRestrictions;
module.exports.RESTRICTING_ATTRIBUTES = RESTRICTING_ATTRIBUTES;
