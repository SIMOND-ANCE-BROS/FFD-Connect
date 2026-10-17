/**
 * Support access « se connecter en tant que » (#545, #733): the session rules
 * shared by the token issuer (AuthService), the per-request check
 * (JwtStrategy) and the readers of the journal (GDPR export).
 */

/** Lifetime of an impersonation token (short, never refreshed). */
export const IMPERSONATION_TOKEN_EXPIRY_MINUTES = 15;

const IMPERSONATION_TOKEN_EXPIRY_MS =
  IMPERSONATION_TOKEN_EXPIRY_MINUTES * 60_000;

/**
 * When a journalled session really ended. A session closed by its author ends
 * at the stop; one never closed (app killed, token left to expire) ends when
 * its token expired, `startedAt` + 15 min, since no request can be made under
 * it afterwards. `null` while the session can still be in use.
 */
export function effectiveImpersonationEnd(
  session: { startedAt: Date; endedAt: Date | null },
  now: Date = new Date(),
): Date | null {
  const expiry = new Date(
    session.startedAt.getTime() + IMPERSONATION_TOKEN_EXPIRY_MS,
  );
  if (session.endedAt) {
    return session.endedAt < expiry ? session.endedAt : expiry;
  }
  return now >= expiry ? expiry : null;
}
