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
 * `beforeScreenshot` for `Sentry.init` (defense in depth, #225): the app shows
 * a refusal's server text in an alert right after the error is handled, and
 * the screenshot integration captures asynchronously — it could photograph
 * that alert. No screenshot for those errors, whatever path captured them.
 */
export function beforeScreenshot(
  _event: unknown,
  hint: { originalException?: unknown },
): boolean {
  return !isExpectedServerRefusal(hint.originalException);
}
