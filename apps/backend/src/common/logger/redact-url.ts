/**
 * Path segments that carry a bearer secret. The Apple Wallet pass download
 * link (#162) authenticates with a single-use token in the URL: after a 429
 * or 503 that token is still valid, so it must never reach logs, Sentry
 * events or metric labels.
 *
 * Matching is deliberately loose, because Express routes case-insensitively
 * and a raw URL may arrive in any spelling:
 * - any case (`/API/V1/LICENSES/WALLET/APPLE/<token>` reaches the handler);
 * - separators written as `/`, repeated `//`, or percent-encoded (`%2F`,
 *   double-encoded `%252F`), with or without the `api/v1` prefix, inside a
 *   path or a full URL;
 * - the whole segment is replaced up to the next real `/`, `?`, `#`,
 *   whitespace or quote — so an encoded `%2F` inside the token itself is
 *   swallowed too, and a query string / trailing slash is kept.
 */
const SEP = "(?:/|%2f|%252f)+";
const SECRET_PATH_SEGMENTS: RegExp[] = [
  new RegExp(`(licenses${SEP}wallet${SEP}apple${SEP})[^/?#\\s"'<>]+`, "gi"),
];

export const REDACTED_SEGMENT = "[REDACTED]";

/** Replaces secret path segments anywhere in a string (URL, message, …). */
export function redactSecretsInText(text: string): string {
  return SECRET_PATH_SEGMENTS.reduce(
    (current, pattern) => current.replace(pattern, `$1${REDACTED_SEGMENT}`),
    text,
  );
}

/** Request URL safe to log or to use as a metric label. */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  return redactSecretsInText(url);
}

/**
 * Deep copy of `value` with every string redacted. Used to scrub Sentry
 * events, transactions, spans and breadcrumbs, whose request URL, transaction
 * name and span attributes (`url.full`, `http.target`, …) carry the raw URL.
 */
export function redactSecretsDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactSecretsInText(value) as T;
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item: unknown) =>
      redactSecretsDeep(item, depth + 1),
    ) as T;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  // Only plain objects are rebuilt; Dates, Errors, buffers… are kept as is.
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactSecretsDeep(item, depth + 1);
  }
  return out as T;
}
