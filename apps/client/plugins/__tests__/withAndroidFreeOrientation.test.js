/**
 * @jest-environment node
 * @jest-environment-options {"customExportConditions": ["node", "require"]}
 *
 * Config plugins run in Node during `expo prebuild`, never in the app bundle,
 * so they are tested under Node's export conditions (see
 * withFirebaseHeadlessLaunch.test.js).
 */
const {
  removeOrientationRestrictions,
  RESTRICTING_ATTRIBUTES,
} = require("../withAndroidFreeOrientation");

/** MainActivity as emitted by `expo prebuild` on SDK 57 with orientation: portrait. */
function buildManifest(extraActivityAttributes = {}) {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [
        {
          $: {
            "android:name": ".MainApplication",
            "android:resizeableActivity": "false",
          },
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:configChanges":
                  "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|locale|layoutDirection",
                "android:launchMode": "singleTask",
                "android:exported": "true",
                "android:screenOrientation": "portrait",
                ...extraActivityAttributes,
              },
            },
          ],
        },
      ],
    },
  };
}

describe("withAndroidFreeOrientation", () => {
  it("removes the portrait lock from MainActivity", () => {
    const manifest = removeOrientationRestrictions(buildManifest());
    const activity = manifest.manifest.application[0].activity[0].$;

    expect(activity).not.toHaveProperty("android:screenOrientation");
  });

  it("removes every resize / aspect-ratio restriction, on activity and application", () => {
    const manifest = removeOrientationRestrictions(
      buildManifest({
        "android:resizeableActivity": "false",
        "android:maxAspectRatio": "2.1",
        "android:minAspectRatio": "1.5",
      }),
    );
    const application = manifest.manifest.application[0].$;
    const activity = manifest.manifest.application[0].activity[0].$;

    for (const attribute of RESTRICTING_ATTRIBUTES) {
      expect(activity).not.toHaveProperty(attribute);
      expect(application).not.toHaveProperty(attribute);
    }
  });

  it("keeps the other activity attributes (configChanges avoids a restart on rotation)", () => {
    const manifest = removeOrientationRestrictions(buildManifest());
    const activity = manifest.manifest.application[0].activity[0].$;

    expect(activity["android:name"]).toBe(".MainActivity");
    expect(activity["android:configChanges"]).toContain("orientation");
    expect(activity["android:launchMode"]).toBe("singleTask");
  });

  it("tolerates a manifest without application or activity", () => {
    expect(() => removeOrientationRestrictions({ manifest: {} })).not.toThrow();
    expect(() =>
      removeOrientationRestrictions({ manifest: { application: [{}] } }),
    ).not.toThrow();
  });
});
