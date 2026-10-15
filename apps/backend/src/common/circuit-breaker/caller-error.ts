/**
 * Circuit breaker error filter (#437): tells a remote service's answer to a
 * bad request (the caller's fault) from an outage of that service.
 *
 * A caller error must not count as a breaker failure, otherwise a burst of
 * invalid requests (unknown WDSF MIN, missing blob, unreadable image, stale
 * push token…) opens the breaker for every user and turns valid requests
 * into 503. The error itself is still rethrown to the caller unchanged.
 *
 * Counted as outages (NOT filtered): 5xx, 408, 429, timeouts, network
 * errors, and any error without a recognisable status.
 */

/** Firebase Cloud Messaging codes describing a bad message or token. */
const FCM_CALLER_ERROR_CODES: ReadonlySet<string> = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-recipient",
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-payload",
  "messaging/invalid-data-payload-key",
  "messaging/payload-size-limit-exceeded",
  "messaging/invalid-options",
  "messaging/invalid-package-name",
  "messaging/mismatched-credential",
]);

/** 4xx statuses that still signal an overloaded or slow service. */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

/**
 * HTTP status carried by an error, whatever the client that raised it:
 * axios / Nest HttpService (`response.status`), Azure SDK `RestError` and
 * Resend (`statusCode`), plain `status`, Nest `HttpException` (`getStatus()`).
 */
export function getErrorHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const response = error.response;
  if (isRecord(response)) {
    const status = numberOrUndefined(response.status);
    if (status !== undefined) return status;
  }
  const direct =
    numberOrUndefined(error.statusCode) ?? numberOrUndefined(error.status);
  if (direct !== undefined) return direct;
  if (typeof error.getStatus === "function") {
    return numberOrUndefined((error.getStatus as () => unknown).call(error));
  }
  return undefined;
}

/** True when a 4xx status (other than 408/429) is the caller's fault. */
export function isCallerErrorStatus(status: number): boolean {
  return (
    status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)
  );
}

/**
 * opossum `errorFilter`: true when the remote service answered and rejected
 * the request itself, so the failure is not counted against the service.
 */
export function isCallerError(error: unknown): boolean {
  const status = getErrorHttpStatus(error);
  if (status !== undefined) return isCallerErrorStatus(status);
  if (isRecord(error) && typeof error.code === "string") {
    return FCM_CALLER_ERROR_CODES.has(error.code);
  }
  return false;
}
