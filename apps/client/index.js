/**
 * @format
 * Entry point natif (iOS/Android). Pour le web, Expo utilise index.web.js via main: "index".
 */

// Polyfills first — must execute before react-native/expo imports.
import "./polyfills";
import React from "react";
import { registerRootComponent } from "expo";
import { Platform } from "react-native";
import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import App from "./App";
import { registerBackgroundMessageHandler } from "./src/features/settings/services/backgroundMessaging";
import { beforeScreenshot } from "./src/utils/sentryPrivacy";

// Crash diagnosis: catch JS errors before they propagate to Hermes uncaught
// (which causes a SIGABRT with no useful info). Logs full message + stack
// to console — visible via Mac Console.app filtered by "FFDConnect".
try {
  const ErrorUtils = global.ErrorUtils;
  if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === "function") {
    const previous = ErrorUtils.getGlobalHandler?.();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      console.error(
        `[FFDConnect ${isFatal ? "FATAL" : "ERROR"}] ${error?.name || "Error"}: ${error?.message || String(error)}\n${error?.stack || "(no stack)"}`,
      );
      if (typeof previous === "function") previous(error, isFatal);
    });
  }
} catch {
  /* swallow — never let the diagnostic block boot */
}

// Unhandled promise rejection tracking — Hermes terminate (throwPendingError →
// SIGABRT) is often triggered by an unhandled rejected promise that ErrorUtils
// does not see. Hook the Hermes-internal tracker to log every unhandled
// rejection to console so we can identify the failing module on the next crash.
try {
  if (
    typeof globalThis.HermesInternal !== "undefined" &&
    typeof globalThis.HermesInternal.enablePromiseRejectionTracker ===
      "function"
  ) {
    globalThis.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id, rejection) => {
        console.error(
          `[FFDConnect UNHANDLED_REJECTION id=${id}] ${rejection?.name || "Error"}: ${rejection?.message || String(rejection)}\n${rejection?.stack || "(no stack)"}`,
        );
      },
      onHandled: (id) => {
        console.warn(`[FFDConnect REJECTION_HANDLED id=${id}] late-handled`);
      },
    });
  }
} catch {
  /* swallow */
}

// Sentry : initialisation uniquement si DSN configuré (EAS / .env).
// Kill-switch EXPO_PUBLIC_DISABLE_SENTRY=1 to bypass Sentry entirely — used to
// isolate whether Sentry is the cause of the iOS 26 SIGABRT at boot.
const rawDsn =
  typeof process !== "undefined"
    ? process.env?.EXPO_PUBLIC_SENTRY_DSN
    : undefined;
const sentryDsn =
  typeof rawDsn === "string" &&
  rawDsn.trim().length > 0 &&
  !rawDsn.includes("...")
    ? rawDsn.trim()
    : undefined;
const sentryDisabled = process.env?.EXPO_PUBLIC_DISABLE_SENTRY === "1";

// Release Health : rattache le crash-free sessions rate à une version + un OTA,
// avec les identifiants de TestFlight / Play et des tags beta-<version>-<plateforme>-<build>
// (cf. src/utils/appIdentity).
// - release  = « <bundle id>@<version>+<build> » (ex. fr.ffdanse.connect.beta@1.0.0+85) :
//   le format Sentry des apps mobiles, celui que le plugin Sentry utilise pour
//   les source maps du build natif. Le bundle id sépare preview et beta, qui
//   comptent leurs builds chacune de leur côté. La runtimeVersion n'y est plus :
//   c'est une empreinte (hash), gardée en tag `ota_runtime`.
// - dist     = numéro de build sur le bundle embarqué (là encore, comme les
//   source maps du build), updateId sous OTA. Deux OTA différentes sous la même
//   release = deux dist → on voit qu'une OTA précise régresse avant qu'elle se
//   répande.
const nativeBuild = Application.nativeBuildVersion ?? "0";
const releaseVersion =
  Application.applicationId && Application.nativeApplicationVersion
    ? `${Application.applicationId}@${Application.nativeApplicationVersion}+${nativeBuild}`
    : "ffd-client@unknown";
const updateDist =
  typeof Updates.updateId === "string" &&
  Updates.updateId &&
  !Updates.isEmbeddedLaunch
    ? Updates.updateId
    : nativeBuild;

if (sentryDsn && !sentryDisabled && Platform.OS !== "web") {
  Sentry.init({
    dsn: sentryDsn,
    enabled: true,
    environment:
      typeof __DEV__ !== "undefined" && __DEV__
        ? "development"
        : process.env.EXPO_PUBLIC_APP_ENV || "production",
    release: releaseVersion,
    dist: updateDist,
    tracesSampleRate: 0.1,
    attachScreenshot: true,
    // No screenshot for an expected server refusal (#225): the app shows its
    // text in an alert, which may be health data (refused medical certificate).
    // Nor while a screen showing health data is mounted (#242,
    // useSensitiveScreen). attachViewHierarchy stays off (default): it would
    // carry the on-screen text.
    beforeScreenshot,
    // Session Replay disabled on iOS 26+ — RNSentryReplayUnmask shadow node
    // hooks the network stack and triggers nw_protocol_ipv6 crashes.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Strip mobileReplay/Replay integrations even if SDK auto-adds them — the
    // shadow node remains registered in the binary but at least the runtime
    // listener layer is removed, which is enough on most cases.
    integrations: (defaults) =>
      defaults.filter(
        (i) =>
          i.name !== "MobileReplay" &&
          i.name !== "Replay" &&
          i.name !== "ReactNativeReplay",
      ),
  });
  // Le SHA git relie un crash au code exact (tags/releases GitHub).
  Sentry.setTag("git_sha", process.env.EXPO_PUBLIC_GIT_SHA || "unknown");
  Sentry.setTag(
    "ota_runtime",
    typeof Updates.runtimeVersion === "string" && Updates.runtimeVersion
      ? Updates.runtimeVersion.slice(0, 7)
      : "unknown",
  );
}

// Barre native clavier iOS (^ v ✓) — désactivé sur iOS 26+ : la lib hook le
// main run loop et provoque un crash natif dans RCTJSTimerExecutor (Data Abort
// far=0). Ré-activable quand react-native-keyboard-manager sera mis à jour.
if (typeof window !== "undefined" && Platform.OS === "ios") {
  const iosVersion = parseInt(String(Platform.Version), 10);
  const isIOS26Plus = Number.isFinite(iosVersion) && iosVersion >= 26;
  if (!isIOS26Plus) {
    try {
      const KeyboardManager = require("react-native-keyboard-manager").default;
      if (KeyboardManager) {
        KeyboardManager.setEnable(true);
        KeyboardManager.setEnableAutoToolbar(true);
        KeyboardManager.setToolbarPreviousNextButtonEnable(true);
        KeyboardManager.setToolbarDoneBarButtonItemText("Terminé");
      }
    } catch {
      // Attendu dans Expo Go (module natif absent)
    }
  }
}

// Audio now runs on expo-audio (see src/utils/TrackPlayerWrapper.ts). No headless
// playback service to register — react-native-track-player has been retired.

// Firebase background message handler (#775). RNFB requires it at module scope,
// synchronously, before registerRootComponent: a data-only message received
// while the app is killed runs in a headless task that never mounts <App />.
// NEVER import @react-native-firebase/messaging statically here — the native
// module only exists on variants that ship a Firebase config file (see
// FIREBASE_ENABLED in app.config.js); registerBackgroundMessageHandler loads it
// lazily and is a silent no-op without it. The try is belt and braces: nothing
// in this path may block boot.
try {
  registerBackgroundMessageHandler();
} catch {
  /* swallow — never let push setup block boot */
}

const Root =
  sentryDsn && !sentryDisabled && Platform.OS !== "web"
    ? Sentry.wrap(App)
    : App;

// iOS may launch the app in the background to deliver a data-only
// (content-available) push. That launch loads the JS bundle so the background
// handler registered above can run — but it has no reason to mount the whole
// React tree out of the user's sight. `isHeadless` is seeded into the initial
// props by plugins/withFirebaseHeadlessLaunch.js; it is simply absent on every
// other platform and on normal launches, so this returns <Root /> as before.
// No JSX here: index.js is plain .js and deliberately stays transform-agnostic.
function HeadlessAwareRoot(props) {
  if (props && props.isHeadless) return null;
  return React.createElement(Root, props);
}

registerRootComponent(HeadlessAwareRoot);
