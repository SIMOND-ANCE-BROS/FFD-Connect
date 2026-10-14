import type { ErrorEvent } from "@sentry/react-native";
import { screenshotIntegration } from "@sentry/react-native";
import {
  getHttpErrorInfo,
  httpFingerprint,
  isExpectedHttpStatus,
} from "./httpErrorInfo";
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
 * `integrations` callback for `Sentry.init`: drops the replay integrations
 * (iOS 26 crash) and adds the JS screenshot integration that
 * `attachScreenshot: false` no longer adds by default.
 */
export function sentryIntegrations(defaults: Integration[]): Integration[] {
  const kept = defaults.filter((i) => !REPLAY_INTEGRATIONS.has(i.name));
  if (kept.some((i) => i.name === "Screenshot")) return kept;
  return [...kept, screenshotIntegration()];
}

/**
 * `beforeSend` for `Sentry.init` (#585). Every AxiosError shares the same
 * minified stack (`settle`), so Sentry merged unrelated HTTP failures (a
 * preview 401, a beta 429) into one issue. Whatever path captured the error
 * (logger, a feature calling `Sentry.captureException` directly), an HTTP
 * error gets:
 * - a fingerprint by status + method + normalized route (ids/query stripped),
 *   unless the caller already set one;
 * - `http_status` / `http_route` tags;
 * - the `warning` level when its status is an expected 4xx (401, 429...), so
 *   it does not page as an error.
 * Non-HTTP events are returned untouched.
 */
export function sentryBeforeSend(
  event: ErrorEvent,
  hint: { originalException?: unknown },
): ErrorEvent {
  const http = getHttpErrorInfo(hint.originalException);
  if (!http) return event;
  if (!event.fingerprint || event.fingerprint.length === 0) {
    event.fingerprint = httpFingerprint(http);
  }
  event.tags = {
    ...event.tags,
    http_status: http.status === undefined ? "network" : String(http.status),
    http_route: http.route,
  };
  if (isExpectedHttpStatus(http.status)) {
    event.level = "warning";
  }
  return event;
}
