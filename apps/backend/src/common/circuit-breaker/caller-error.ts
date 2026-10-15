import { HttpException } from "@nestjs/common";
import axios from "axios";

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
 * errors, any error without a recognisable status, and 401/403 unless the
 * breaker opts in with `ignoreAuthErrors` (see CallerErrorOptions).
 */

export interface CallerErrorOptions {
  /**
   * Also treat 401/403 as caller errors. Only for breakers whose credentials
   * belong to the caller (HelloAsso: one set per club organisation). With one
   * global credential (managed identity, API key), a 401/403 means our own
   * configuration is broken: it must open the breaker and fail fast.
   */
  ignoreAuthErrors?: boolean;
}

/**
 * Firebase Cloud Messaging codes describing a bad message or device token.
 * `messaging/mismatched-credential` is deliberately absent: it means the
 * server uses the wrong Firebase project, an outage for every send.
 */
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
]);

/** 4xx statuses that still signal an overloaded or slow service. */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/** 4xx statuses that reject our credentials rather than the request. */
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

/**
 * HTTP status carried by an error, read only from fields the client sets
 * itself, never from a response body (a remote `{ status: 404 }` payload
 * must not mask an outage):
 * - Nest `HttpException` → `getStatus()`;
 * - axios / Nest `HttpService` → `response.status`;
 * - other `Error`s with their own `statusCode` / `status` (Azure SDK
 *   `RestError`, `EmailSendError`, `FfdDocumentHttpError`).
 */
export function getErrorHttpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  if (axios.isAxiosError(error)) return error.response?.status;
  if (!(error instanceof Error)) return undefined;
  const own = error as Error & { statusCode?: unknown; status?: unknown };
  return numberOrUndefined(own.statusCode) ?? numberOrUndefined(own.status);
}

/** True when a 4xx status is the caller's fault (never 408/429). */
export function isCallerErrorStatus(
  status: number,
  options: CallerErrorOptions = {},
): boolean {
  if (status < 400 || status >= 500) return false;
  if (RETRYABLE_CLIENT_STATUSES.has(status)) return false;
  if (AUTH_STATUSES.has(status)) return options.ignoreAuthErrors === true;
  return true;
}

/**
 * opossum `errorFilter`: true when the remote service answered and rejected
 * the request itself, so the failure is not counted against the service.
 */
export function isCallerError(
  error: unknown,
  options: CallerErrorOptions = {},
): boolean {
  const status = getErrorHttpStatus(error);
  if (status !== undefined) return isCallerErrorStatus(status, options);
  if (error instanceof Error) {
    const { code } = error as Error & { code?: unknown };
    return typeof code === "string" && FCM_CALLER_ERROR_CODES.has(code);
  }
  return false;
}
