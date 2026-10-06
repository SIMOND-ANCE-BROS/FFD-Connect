/**
 * The native fingerprint (runtimeVersion `policy: "fingerprint"`) is computed
 * from the evaluated Expo config, on the GitHub runner AND on the EAS builder.
 * Only the builder has the Firebase config file (EAS "file" env var), so the
 * config must not depend on that file existing — otherwise EAS rejects the
 * build with "Runtime version mismatch" and no OTA reaches any binary.
 */
import fs from "fs";
import os from "os";
import path from "path";

type PluginEntry = string | [string, unknown];

interface EvaluatedConfig {
  expo: {
    plugins: PluginEntry[];
    ios: {
      googleServicesFile?: string;
      entitlements?: Record<string, string>;
      infoPlist: Record<string, unknown>;
    };
    android: { googleServicesFile?: string };
  };
}

const ENV_KEYS = [
  "EXPO_PUBLIC_APP_ENV",
  "EAS_BUILD",
  "EAS_BUILD_PROFILE",
  "GOOGLE_SERVICE_INFO_PLIST_PREVIEW",
  "GOOGLE_SERVICES_JSON_PREVIEW",
  "GOOGLE_SERVICE_INFO_PLIST_DEVELOPMENT",
  "GOOGLE_SERVICES_JSON_DEVELOPMENT",
] as const;

const FIREBASE_PLUGINS = [
  "@react-native-firebase/app",
  "@react-native-firebase/messaging",
  "./plugins/withFirebaseHeadlessLaunch.js",
];

function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  let config: EvaluatedConfig | undefined;
  try {
    jest.isolateModules(() => {
      config = require("../app.config.js") as EvaluatedConfig;
    });
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  if (!config) throw new Error("app.config.js did not load");
  return config.expo;
}

/** What @expo/fingerprint hashes: googleServicesFile is stripped from it. */
function fingerprintedShape(expo: EvaluatedConfig["expo"]) {
  const ios = { ...expo.ios };
  const android = { ...expo.android };
  delete ios.googleServicesFile;
  delete android.googleServicesFile;
  return { ...expo, ios, android };
}

const pluginNames = (expo: EvaluatedConfig["expo"]) =>
  expo.plugins.map((p) => (typeof p === "string" ? p : p[0]));

describe("app.config.js — fingerprint determinism", () => {
  let secretsDir: string;

  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    secretsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "eas-environment-secrets-"),
    );
    fs.writeFileSync(path.join(secretsDir, "plist"), "<plist/>");
    fs.writeFileSync(path.join(secretsDir, "json"), "{}");
  });

  afterAll(() => {
    fs.rmSync(secretsDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("evaluates a distributed variant identically with or without the EAS Firebase secret", () => {
    const runner = loadConfig({ EXPO_PUBLIC_APP_ENV: "preview" });
    const builder = loadConfig({
      EXPO_PUBLIC_APP_ENV: "preview",
      EAS_BUILD: "true",
      EAS_BUILD_PROFILE: "preview",
      GOOGLE_SERVICE_INFO_PLIST_PREVIEW: path.join(secretsDir, "plist"),
      GOOGLE_SERVICES_JSON_PREVIEW: path.join(secretsDir, "json"),
    });

    expect(fingerprintedShape(runner)).toEqual(fingerprintedShape(builder));
  });

  it("keeps Firebase (plugins, APNs entitlement, background mode) on for distributed variants", () => {
    for (const appEnv of ["preview", "beta", "production"]) {
      const expo = loadConfig({ EXPO_PUBLIC_APP_ENV: appEnv });

      expect(pluginNames(expo)).toEqual(
        expect.arrayContaining(FIREBASE_PLUGINS),
      );
      expect(expo.ios.entitlements).toEqual({
        "aps-environment": "production",
      });
      expect(expo.ios.infoPlist.UIBackgroundModes).toEqual([
        "remote-notification",
      ]);
      // Set even when absent, so the RNFB plugin names the missing file.
      expect(expo.ios.googleServicesFile).toBe(
        `./firebase/GoogleService-Info.${appEnv}.plist`,
      );
    }
  });

  it("uses the EAS secret path for googleServicesFile on the builder", () => {
    const expo = loadConfig({
      EXPO_PUBLIC_APP_ENV: "preview",
      GOOGLE_SERVICE_INFO_PLIST_PREVIEW: path.join(secretsDir, "plist"),
    });

    expect(expo.ios.googleServicesFile).toBe(path.join(secretsDir, "plist"));
  });

  // A developer may have dropped the development files locally (firebase/).
  const hasLocalDevFirebase = [
    "GoogleService-Info.development.plist",
    "google-services.development.json",
  ].some((f) => fs.existsSync(path.join(__dirname, "..", "firebase", f)));

  (hasLocalDevFirebase ? it.skip : it)(
    "leaves Firebase off for a development build without a config file",
    () => {
      const expo = loadConfig({ EXPO_PUBLIC_APP_ENV: "development" });

      expect(pluginNames(expo)).not.toEqual(
        expect.arrayContaining([FIREBASE_PLUGINS[0]]),
      );
      expect(expo.ios.entitlements).toBeUndefined();
      expect(expo.ios.googleServicesFile).toBeUndefined();
    },
  );

  it("enables Firebase for development when a config file is provided", () => {
    const expo = loadConfig({
      EXPO_PUBLIC_APP_ENV: "development",
      GOOGLE_SERVICE_INFO_PLIST_DEVELOPMENT: path.join(secretsDir, "plist"),
    });

    expect(pluginNames(expo)).toEqual(expect.arrayContaining(FIREBASE_PLUGINS));
    expect(expo.ios.entitlements).toEqual({
      "aps-environment": "development",
    });
  });
});
