/**
 * Personal-data scrubbing for what the logger sends to Sentry (#589).
 *
 * Since #589 the logger runs in release builds: `warn` becomes a Sentry
 * breadcrumb and `error` an event carrying the call's `data` as `extra`. Call
 * sites were written when none of that left the device, so this is the
 * single choke point that keeps e-mails, names, tokens and query strings
 * (search terms) out of Sentry, whatever a caller passes.
 */

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;

/**
 * Keys whose value is personal data or a credential. Matched on the whole key
 * (case-insensitive) so `trackName`/`clubName` style keys stay readable while
 * `name`, `email`, `firstName`, `accessToken`... are dropped.
 */
const SENSITIVE_KEY =
  /^(name|(first|last|full|user|display|nick)_?name|e-?mail(address)?|login|pass(word)?|new_?password|old_?password|current_?password|secret|authorization|cookie|phone(number)?|birth_?date|date_?of_?birth|address|licen[cs]e_?(number|id)?|wdsf_?id|ssn|iban)$|token/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// A query string (`?q=...&x=...`): search terms, e-mails, reset tokens.
const QUERY = /\?[^\s"'`]*=[^\s"'`]*/g;

/** Strips e-mails, bearer tokens, JWTs and query strings from free text. */
export function scrubText(text: string): string {
  return text
    .replace(JWT, "[jwt]")
    .replace(BEARER, "Bearer [token]")
    .replace(EMAIL, "[email]")
    .replace(QUERY, "?[query]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Returns a JSON-safe copy of `value` with sensitive keys redacted and every
 * string passed through {@link scrubText}. Errors are reduced to their name
 * and scrubbed message (an AxiosError carries the request headers, so the
 * Authorization header, in its `config`). Bounded in depth and array length.
 */
export function scrubLogData(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message) };
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => scrubLogData(item, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : scrubLogData(item, depth + 1);
    }
    return out;
  }
  return undefined;
}
