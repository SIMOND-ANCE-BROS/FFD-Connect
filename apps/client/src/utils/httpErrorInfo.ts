/**
 * Classification of HTTP errors for logging and Sentry (#585).
 *
 * Every AxiosError shares the same minified stack (`settle`), so Sentry merged
 * a preview 401 and a beta 429 into one issue. This module extracts a stable
 * identity (status + method + normalized route) used as the Sentry
 * fingerprint, and decides which 4xx are expected outcomes rather than bugs.
 *
 * Duck-typed on purpose: the logger is imported everywhere, it must not pull
 * axios nor `httpInterceptor` (which itself imports the logger).
 */

export interface HttpErrorInfo {
  /** HTTP status, or `undefined` for a network error (no response). */
  status: number | undefined;
  /** Upper-case HTTP method, `"UNKNOWN"` when not available. */
  method: string;
  /** Path without origin, query, hash, with id-like segments replaced. */
  route: string;
}

/**
 * 4xx that are expected outcomes of normal use, not client bugs:
 * - 401: expired access token (handled by the silent refresh) or bad
 *   credentials on login;
 * - 403: the user lacks the role/permission — a business refusal;
 * - 404: the entity does not exist (no licence yet, deleted track...);
 * - 408: request timeout — transient, like a network error;
 * - 409 / 410: business conflict, resource gone;
 * - 429: rate limited — the backend throttles, the client backs off.
 * Any other 4xx (400, 405, 413, 415, 422...) means the client sent something
 * the API rejects: a bug worth an exception in Sentry.
 */
const EXPECTED_CLIENT_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 404, 408, 409, 410, 429,
]);

const ID_SEGMENT_PATTERNS: readonly RegExp[] = [
  /^\d+$/, // numeric id
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^c[a-z0-9]{20,}$/, // cuid
  /^[0-9a-f]{16,}$/i, // hex hashes / object ids
];

function isIdSegment(segment: string): boolean {
  if (ID_SEGMENT_PATTERNS.some((re) => re.test(segment))) return true;
  // Long opaque tokens mixing letters and digits (licence numbers, slugs
  // with ids...). Plain words like "notifications" have no digit.
  return segment.length >= 12 && /\d/.test(segment) && /[a-z]/i.test(segment);
}

/**
 * Normalizes a request URL into a route usable as a grouping key: drops the
 * origin, query string and hash, and replaces id-like segments with `:id`.
 * `https://api/x/tracks/42?q=a` → `/tracks/:id`.
 */
export function normalizeRoute(url: string | undefined): string {
  if (!url) return "unknown";
  let path = url.split(/[?#]/)[0] ?? "";
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => (isIdSegment(s) ? ":id" : s));
  return `/${segments.join("/")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Extracts the HTTP identity of an AxiosError (`isAxiosError`) or an
 * `HttpError` from `httpInterceptor` (`statusCode`). Returns `null` for any
 * other error.
 */
export function getHttpErrorInfo(error: unknown): HttpErrorInfo | null {
  if (!isRecord(error)) return null;

  if (error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const config = isRecord(error.config) ? error.config : undefined;
    const status =
      typeof response?.status === "number" ? response.status : undefined;
    const method =
      typeof config?.method === "string"
        ? config.method.toUpperCase()
        : "UNKNOWN";
    const url = typeof config?.url === "string" ? config.url : undefined;
    return { status, method, route: normalizeRoute(url) };
  }

  if (error.name === "HttpError" && typeof error.statusCode === "number") {
    return {
      // statusCode 0 = network failure in httpInterceptor.
      status: error.statusCode === 0 ? undefined : error.statusCode,
      method: "UNKNOWN",
      route: "unknown",
    };
  }

  return null;
}

/** True for a 4xx that is an expected outcome (see EXPECTED_CLIENT_STATUSES). */
export function isExpectedHttpStatus(status: number | undefined): boolean {
  return status !== undefined && EXPECTED_CLIENT_STATUSES.has(status);
}

/** Sentry fingerprint: one issue per status + method + route. */
export function httpFingerprint(info: HttpErrorInfo): string[] {
  return [
    "http-error",
    info.status === undefined ? "network" : String(info.status),
    info.method,
    info.route,
  ];
}
