import { Prisma, UserRole } from "@prisma/client";

export type AccountBlockReason = "USER_DISABLED" | "CLUB_DISABLED";

/** Shown by the mobile login screen and the back-office as is. */
export const ACCOUNT_DISABLED_MESSAGE =
  "Compte désactivé. Contactez la fédération.";

/**
 * The fields the decision needs. All optional: the legacy fallback select of
 * login and partial test mocks do not carry them, and "unknown" means active.
 */
export interface AccountStatusFields {
  role?: string | null;
  extraRoles?: readonly string[] | null;
  disabledAt?: Date | null;
  club?: { disabledAt?: Date | null } | null;
}

/**
 * Single source of truth for "may this account act?", used at login,
 * at refresh and on every authenticated request (JwtStrategy).
 * A disabled club blocks only accounts whose MAIN role is CLUB. An extra CLUB
 * role is dropped by rolesOf instead (the dancer behind it keeps their access).
 */
export function accountBlockReason(
  user: AccountStatusFields,
): AccountBlockReason | null {
  if (user.disabledAt) return "USER_DISABLED";
  if (user.role === UserRole.CLUB && user.club?.disabledAt) {
    return "CLUB_DISABLED";
  }
  return null;
}

/**
 * Prisma counterpart of {@link accountBlockReason}: the accounts that may act,
 * and therefore the only ones that may be notified (#301). A disabled account
 * cannot log in to read or act on a notification, and its phone, lost or
 * handed over, must not keep showing alerts on the lock screen.
 *
 * Written with a positive OR rather than `NOT { role: CLUB, club: … }`: a
 * negated relation filter goes through SQL three-valued logic on a null
 * `clubId`, and would silently drop club-less accounts.
 */
export const notifiableAccountWhere = {
  disabledAt: null,
  OR: [
    { role: { not: UserRole.CLUB } },
    { club: { is: null } },
    { club: { is: { disabledAt: null } } },
  ],
} as const satisfies Prisma.UserWhereInput;
