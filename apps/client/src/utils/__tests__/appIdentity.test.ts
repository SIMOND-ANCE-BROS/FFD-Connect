import { envLabel } from "../../config";
import type * as AppIdentityModule from "../appIdentity";

type UpdatesState = {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  createdAt: Date | null;
};

const EMBEDDED: UpdatesState = {
  isEnabled: true,
  isEmbeddedLaunch: true,
  updateId: null,
  channel: "beta",
  runtimeVersion: "57e6f4ff91497b5c9e0d9135d9391b7d0cdedb2d",
  createdAt: null,
};

/** Recharge appIdentity avec un état expo-updates / env donné (lus à l'import). */
function load(
  updates: Partial<UpdatesState>,
  env: { sha?: string; appEnv?: string } = {},
): typeof AppIdentityModule {
  let mod: typeof AppIdentityModule | undefined;
  jest.isolateModules(() => {
    if (env.sha === undefined) delete process.env.EXPO_PUBLIC_GIT_SHA;
    else process.env.EXPO_PUBLIC_GIT_SHA = env.sha;
    process.env.EXPO_PUBLIC_APP_ENV = env.appEnv ?? "development";
    jest.doMock("expo-updates", () => ({
      __esModule: true,
      ...EMBEDDED,
      ...updates,
    }));
    mod = jest.requireActual<typeof AppIdentityModule>("../appIdentity");
  });
  return mod!;
}

describe("appIdentity", () => {
  const savedSha = process.env.EXPO_PUBLIC_GIT_SHA;
  const savedEnv = process.env.EXPO_PUBLIC_APP_ENV;
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  // Pas de jest.dontMock("expo-updates") : il désactiverait aussi le mock de
  // jest.setup.js. Chaque test repose son propre doMock via load().
  afterEach(() => {
    restore("EXPO_PUBLIC_GIT_SHA", savedSha);
    restore("EXPO_PUBLIC_APP_ENV", savedEnv);
  });

  it("uses the store format for version and build", () => {
    const { getAppIdentity } = load({}, { sha: "302fc8c" });
    expect(getAppIdentity().version).toBe("1.0.0 (85)");
  });

  it("shows the git SHA that tags and releases carry", () => {
    const { getAppIdentity } = load({}, { sha: "302fc8cabcdef" });
    expect(getAppIdentity().code).toBe("302fc8c");
  });

  it("says the code is unknown when no SHA was inlined", () => {
    const { getAppIdentity } = load({});
    expect(getAppIdentity().code).toBe("inconnu");
  });

  it.each([
    ["preview", "Preview (staging)"],
    ["beta", "Bêta (TestFlight)"],
    ["production", "Production"],
    ["development", "Développement"],
  ])(
    "labels channel %s as %s (preview and beta no longer merge)",
    (channel, label) => {
      const { getAppIdentity } = load({ channel });
      expect(getAppIdentity().environment).toBe(label);
    },
  );

  it("names the Play closed test for beta on Android", () => {
    expect(envLabel("beta", "android")).toBe("Bêta (Google Play, test fermé)");
  });

  it("falls back to the build-time variant when there is no channel", () => {
    const { getAppIdentity } = load({ channel: null }, { appEnv: "preview" });
    expect(getAppIdentity().environment).toBe("Preview (staging)");
  });

  it("reports the running OTA with its short id", () => {
    const { getAppIdentity } = load({
      isEmbeddedLaunch: false,
      updateId: "01a11091-aaaa-bbbb-cccc-dddddddddddd",
      createdAt: new Date("2026-10-06T12:02:00Z"),
    });
    expect(getAppIdentity().update).toMatch(/^OTA 01a11091 du /);
  });

  it("reports the embedded bundle when no OTA was applied", () => {
    const { getAppIdentity } = load({});
    expect(getAppIdentity().update).toBe(
      "intégrée au build (aucune OTA appliquée)",
    );
  });

  it("reports Metro when updates are disabled", () => {
    const { getAppIdentity } = load({ isEnabled: false });
    expect(getAppIdentity().update).toBe("dev (Metro, pas d'OTA)");
  });

  it("shortens the fingerprint runtime to 7 characters", () => {
    const { getAppIdentity } = load({});
    expect(getAppIdentity().otaCompatibility).toBe("57e6f4f");
  });

  it("joins everything on one line for tickets", () => {
    const { formatAppIdentityInline } = load(
      { channel: "beta" },
      { sha: "302fc8c" },
    );
    expect(formatAppIdentityInline()).toBe(
      "1.0.0 (85) · Bêta (TestFlight) · 302fc8c · intégrée au build (aucune OTA appliquée)",
    );
  });
});
