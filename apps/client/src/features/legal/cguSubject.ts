import { AuthService } from "../auth/services/AuthService";
import type { CguSubject } from "./cguConsent";

/**
 * Who accepts the CGU in the current session (#894), or null: nobody to ask.
 *
 * Nobody while signed out (the sign-up form has its own checkbox, a sign-in
 * leads to the account's own check) nor during a support session: a staff
 * member must not accept on the user's behalf. A guest accepts for the
 * device. An account is identified by its opaque id (the e-mail for a session
 * opened before the id was kept).
 */
export async function currentCguSubject(): Promise<CguSubject | null> {
  const config = await AuthService.getAuthConfig();
  if (!config.isLoggedIn || config.impersonating) return null;
  if (config.isGuest) return { kind: "guest" };
  const id = config.userId ?? config.username;
  return id ? { kind: "account", id } : null;
}
