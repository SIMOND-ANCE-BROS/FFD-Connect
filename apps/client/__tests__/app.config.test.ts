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
  "GOOGLE_SERVICE_INFO_PLIST_BETA",
  "GOOGLE_SERVICES_JSON_BETA",
  "GOOGLE_SERVICE_INFO_PLIST_PRODUCTION",
  "GOOGLE_SERVICES_JSON_PRODUCTION",
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

  const DISTRIBUTED_VARIANTS = ["preview", "beta", "production"] as const;

  // A developer may have dropped a distributed variant's file locally.
  const hasLocalDistributedFirebase = DISTRIBUTED_VARIANTS.some((appEnv) =>
    [
      `GoogleService-Info.${appEnv}.plist`,
      `google-services.${appEnv}.json`,
    ].some((f) => fs.existsSync(path.join(__dirname, "..", "firebase", f))),
  );

  function expectFirebaseOn(expo: EvaluatedConfig["expo"]) {
    expect(pluginNames(expo)).toEqual(expect.arrayContaining(FIREBASE_PLUGINS));
    expect(expo.ios.entitlements).toEqual({
      "aps-environment": "production",
    });
    expect(expo.ios.infoPlist.UIBackgroundModes).toEqual([
      "remote-notification",
    ]);
  }

  // `eas build` resolves the iOS entitlements client-side (runner, dev
  // machine) by running the mods in introspection mode, and Expo's infoPlist
  // mod reads googleServicesFile: pointing it at an absent file aborts the
  // build with ENOENT before it reaches EAS. Firebase must stay on regardless,
  // so the builder's prebuild still fails loudly (RNFB plugin) without it.
  (hasLocalDistributedFirebase ? it.skip : it)(
    "keeps Firebase on but leaves googleServicesFile unset for distributed variants without the file",
    () => {
      for (const appEnv of DISTRIBUTED_VARIANTS) {
        const expo = loadConfig({ EXPO_PUBLIC_APP_ENV: appEnv });

        expectFirebaseOn(expo);
        expect(expo.ios.googleServicesFile).toBeUndefined();
        expect(expo.android.googleServicesFile).toBeUndefined();
      }
    },
  );

  it("keeps Firebase on and sets googleServicesFile for distributed variants with the file", () => {
    for (const appEnv of DISTRIBUTED_VARIANTS) {
      const suffix = appEnv.toUpperCase();
      const expo = loadConfig({
        EXPO_PUBLIC_APP_ENV: appEnv,
        EAS_BUILD: "true",
        EAS_BUILD_PROFILE: appEnv,
        [`GOOGLE_SERVICE_INFO_PLIST_${suffix}`]: path.join(secretsDir, "plist"),
        [`GOOGLE_SERVICES_JSON_${suffix}`]: path.join(secretsDir, "json"),
      });

      expectFirebaseOn(expo);
      expect(expo.ios.googleServicesFile).toBe(path.join(secretsDir, "plist"));
      expect(expo.android.googleServicesFile).toBe(
        path.join(secretsDir, "json"),
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

describe("fingerprint.config.js — ignored paths", () => {
  // Resolved through expo, which owns @expo/fingerprint.
  const { isIgnoredPath } = require(
    require.resolve("@expo/fingerprint/build/utils/Path", {
      paths: [path.dirname(require.resolve("expo/package.json"))],
    }),
  ) as {
    isIgnoredPath: (filePath: string, ignorePaths: string[]) => boolean;
  };
  const { ignorePaths } = require("../fingerprint.config.js") as {
    ignorePaths: string[];
  };

  it.each([
    "../../../eas-environment-secrets/x",
    "firebase/GoogleService-Info.preview.plist",
    "firebase/google-services.preview.json",
    "ios/Podfile",
    "android/app/build.gradle",
  ])("ignores %s", (filePath) => {
    expect(isIgnoredPath(filePath, ignorePaths)).toBe(true);
  });

  it("keeps the local native module sources in the fingerprint", () => {
    expect(
      isIgnoredPath(
        "modules/lockscreen-transport/ios/LockscreenTransportModule.swift",
        ignorePaths,
      ),
    ).toBe(false);
  });
});
