import { SetMetadata } from "@nestjs/common";

export const THROTTLE_BY_IP_KEY = "ffd:throttle-by-ip";

/**
 * Keeps the global rate limit of a route keyed on the client IP, even when the
 * request carries a valid access token (#633).
 *
 * `GlobalThrottlerGuard` counts an authenticated request per user. That is
 * wrong for an anti-abuse limit aimed at anonymous callers — login, register,
 * password reset, Wallet pass links, volunteer check-in, anonymous analytics:
 * the token is meaningless there, and keying on it would hand an attacker
 * holding several accounts one fresh budget per account from a single
 * address. Put this decorator on every public route that declares its own
 * `@Throttle` limit; `throttle-by-ip.routes.spec.ts` enforces it.
 */
export const ThrottleByIp = () => SetMetadata(THROTTLE_BY_IP_KEY, true);
