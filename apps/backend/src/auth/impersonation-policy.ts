import { UserRole } from "@prisma/client";
import { hasRole, RoleSubject } from "./roles";

/**
 * Single rule for « se connecter en tant que » (#545, #733), applied when the
 * session opens (AuthService.impersonate) AND on every request made under the
 * impersonation token (JwtStrategy), always against the roles read from the
 * database at that moment:
 * - the actor must hold ADMIN or STAFF;
 * - nobody may impersonate an ADMIN;
 * - a STAFF actor (without ADMIN) may only reach a licensee or a club, never
 *   another STAFF account.
 * A demotion of the actor or a promotion of the target therefore ends a live
 * session at its next request.
 */
export type ImpersonationAuthority =
  | typeof UserRole.ADMIN
  | typeof UserRole.STAFF;

/** The role that authorises the actor to impersonate, ADMIN first. */
export function impersonationAuthority(
  actor: RoleSubject,
): ImpersonationAuthority | null {
  if (hasRole(actor, UserRole.ADMIN)) return UserRole.ADMIN;
  if (hasRole(actor, UserRole.STAFF)) return UserRole.STAFF;
  return null;
}

export type ImpersonationTargetRefusal = "TARGET_ADMIN" | "TARGET_STAFF";

/** Why `authority` may not impersonate `target`, or null when it may. */
export function impersonationTargetRefusal(
  authority: ImpersonationAuthority,
  target: RoleSubject,
): ImpersonationTargetRefusal | null {
  if (hasRole(target, UserRole.ADMIN)) return "TARGET_ADMIN";
  if (authority === UserRole.STAFF && hasRole(target, UserRole.STAFF)) {
    return "TARGET_STAFF";
  }
  return null;
}
