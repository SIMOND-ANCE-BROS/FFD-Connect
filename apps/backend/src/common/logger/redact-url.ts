/**
 * Path segments that carry a bearer secret. The Apple Wallet pass download
 * link (#162) authenticates with a single-use token in the URL: after a 429
 * or 503 that token is still valid, so it must never reach logs, Sentry
 * breadcrumbs or metric labels.
 */
const SECRET_PATH_SEGMENTS: RegExp[] = [
  /(\/licenses\/wallet\/apple\/)[^/?#]+/g,
];

export const REDACTED_SEGMENT = "[REDACTED]";

/** Request URL safe to log: secret path segments replaced. */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  return SECRET_PATH_SEGMENTS.reduce(
    (current, pattern) => current.replace(pattern, `$1${REDACTED_SEGMENT}`),
    url,
  );
}
