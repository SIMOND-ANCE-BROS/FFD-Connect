import * as Sentry from "@sentry/react-native";
import { onSessionEnd } from "../services/sessionCleanup";
import type { UserRole } from "../features/auth/services/AuthService";

/**
 * Identifies the signed-in account on Sentry events without personal data
 * (RGPD, #593): only the opaque internal user id and the main role. Never pass
 * an e-mail, a name or a licence number here — Sentry is a third-party
 * processor. Without a known id (older stored session), the user stays
 * anonymous rather than falling back to the login identifier.
 */
export function setSentryUser(userId: string | undefined, role: UserRole) {
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: userId, data: { role } });
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

// A later event (another account, or signed out) must not carry this user.
onSessionEnd(clearSentryUser);
