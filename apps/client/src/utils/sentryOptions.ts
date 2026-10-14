import { screenshotIntegration } from "@sentry/react-native";
import { beforeScreenshot } from "./sentryPrivacy";

type Integration = ReturnType<typeof screenshotIntegration>;

/** Integrations stripped even if the SDK auto-adds them (see index.js). */
const REPLAY_INTEGRATIONS = new Set([
  "MobileReplay",
  "Replay",
  "ReactNativeReplay",
]);

/**
 * Privacy-related `Sentry.init` options (#225, #242).
 *
 * `attachScreenshot` is forwarded to the native SDKs: with `true`, sentry-
 * android / sentry-cocoa screenshot native crashes themselves, never asking
 * our JS `beforeScreenshot` — a native crash on the licence renewal screen
 * would photograph the medical certificate summary. So it stays `false`, and
 * JS-captured errors get their screenshot from `screenshotIntegration()`
 * (added by `sentryIntegrations`), which does honour `beforeScreenshot`.
 *
 * `attachViewHierarchy` stays off: it would carry the on-screen text.
 */
export const sentryPrivacyOptions = {
  attachScreenshot: false,
  attachViewHierarchy: false,
  beforeScreenshot,
} as const;

/**
 * Diagnostics `Sentry.init` options (#539).
 *
 * iOS kills an app in the background without a crash (expired background
 * task 0x8badf00d, jetsam, CPU limit, watchdog) and sentry-cocoa's own
 * watchdog-termination and app-hang tracking deliberately ignore anything
 * that happens while the app is not in the foreground — so such a kill leaves
 * nothing in Sentry. MetricKit diagnostics (iOS 15+) do include crash and hang
 * reports for those terminations; Apple hands them to the app on a later
 * launch and sentry-cocoa turns them into events. `enableMetricKit` is not in
 * the React Native typings but is forwarded as-is to the native SDK, which
 * reads it at start (SentryOptionsInternal): no native build needed.
 */
export const sentryDiagnosticsOptions = {
  enableMetricKit: true,
} as const;

/**
 * `integrations` callback for `Sentry.init`: drops the replay integrations
 * (iOS 26 crash) and adds the JS screenshot integration that
 * `attachScreenshot: false` no longer adds by default.
 */
export function sentryIntegrations(defaults: Integration[]): Integration[] {
  const kept = defaults.filter((i) => !REPLAY_INTEGRATIONS.has(i.name));
  if (kept.some((i) => i.name === "Screenshot")) return kept;
  return [...kept, screenshotIntegration()];
}
