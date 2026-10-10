import { HttpError } from "./httpInterceptor";

/**
 * An expected business refusal from the server: an HttpError whose body
 * carried a stable `code` (#225). It is not a bug, and its text can be health
 * data (a refused medical certificate): it never goes to Sentry.
 */
export function isExpectedServerRefusal(error: unknown): error is HttpError {
  return (
    error instanceof HttpError &&
    typeof error.code === "string" &&
    error.code.length > 0
  );
}

/**
 * Number of mounted screens that display health data (medical certificate
 * summary) or identity documents (#242). A counter rather than a boolean so
 * two overlapping instances (stack transition) cannot clear each other.
 * Mount-based on purpose: a sensitive screen covered by another stack screen
 * stays mounted and keeps blocking screenshots — fail closed.
 */
let sensitiveScreenCount = 0;

/**
 * Flags a sensitive screen as shown. Returns the release function to call on
 * unmount; calling it more than once has no further effect.
 */
export function markSensitiveScreenShown(): () => void {
  sensitiveScreenCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    sensitiveScreenCount -= 1;
  };
}

export function isSensitiveScreenShown(): boolean {
  return sensitiveScreenCount > 0;
}

/**
 * `beforeScreenshot` for `Sentry.init` (defense in depth):
 * - #242: no screenshot at all while a screen showing health data is mounted —
 *   a crash there would otherwise photograph it (RGPD art. 9);
 * - #225: the app shows a refusal's server text in an alert right after the
 *   error is handled, and the screenshot integration captures asynchronously —
 *   it could photograph that alert. No screenshot for those errors, whatever
 *   path captured them.
 */
export function beforeScreenshot(
  _event: unknown,
  hint: { originalException?: unknown },
): boolean {
  if (isSensitiveScreenShown()) return false;
  return !isExpectedServerRefusal(hint.originalException);
}
