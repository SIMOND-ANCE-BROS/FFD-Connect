import { Prisma, UserRole } from "@prisma/client";

/**
 * Multi-profile (lot 1c): one account = a main `role` + `extraRoles`.
 * Every role decision in the backend goes through this module.
 */
// Typed as string: values read from the DB or a token may be unknown, and
// they are filtered by isRole. (`UserRole | string` collapses to string and
// trips no-redundant-type-constituents.)
export interface RoleFields {
  role: string;
  extraRoles?: readonly string[] | null;
  club?: { disabledAt?: Date | null } | null;
}

/** An account row, or `req.user` whose `roles` are already computed. */
export type RoleSubject = RoleFields | { roles: readonly string[] };

const ROLE_ORDER = Object.values(UserRole);

const isRole = (r: unknown): r is UserRole =>
  ROLE_ORDER.includes(r as UserRole);

const inEnumOrder = (roles: Iterable<UserRole>): UserRole[] => {
  const set = new Set(roles);
  return ROLE_ORDER.filter((r) => set.has(r));
};

/**
 * An extra CLUB counts only for an active club (same rule as
 * `withActiveRole`). `club` tells which:
 * - `{ disabledAt: null }`: active club, keep;
 * - `{ disabledAt: <date> }`: disabled club, drop;
 * - `null`: no club relation, drop;
 * - `undefined` (field not selected): status unknown, keep the STORED role.
 *   Only for callers that want stored roles (admin detail, admin self-edit);
 *   every effective-role caller selects `club`.
 */
const keepExtraClub = (club: RoleFields["club"]): boolean =>
  club === undefined || (club !== null && !club.disabledAt);

/**
 * Effective roles: main first, then extras in enum order. An extra CLUB is
 * kept only for an active club, see `keepExtraClub` (a main CLUB is blocked
 * at the account level instead, see accountBlockReason).
 */
export function rolesOf(user: RoleSubject): UserRole[] {
  if ("roles" in user) return user.roles.filter(isRole);
  const main = isRole(user.role) ? [user.role] : [];
  const extras = (user.extraRoles ?? [])
    .filter(isRole)
    .filter((r) => !main.includes(r))
    .filter((r) => r !== UserRole.CLUB || keepExtraClub(user.club));
  return [...main, ...inEnumOrder(extras)];
}

export function hasRole(
  user: RoleSubject | null | undefined,
  role: UserRole,
): boolean {
  return user ? rolesOf(user).includes(role) : false;
}

/** Prisma filter: the account holds `role` as main or extra role. */
export function withRole(role: UserRole): Prisma.UserWhereInput {
  return { OR: [{ role }, { extraRoles: { has: role } }] };
}

/**
 * Prisma filter on EFFECTIVE roles, the DB counterpart of `rolesOf`: an extra
 * CLUB role counts only while the account's club is not disabled. A main CLUB
 * role always matches (such accounts are blocked at the account level). Use it
 * for recipients and access lists; `withRole` = stored roles, for admin counts.
 */
export function withActiveRole(role: UserRole): Prisma.UserWhereInput {
  if (role !== UserRole.CLUB) return withRole(role);
  return {
    OR: [
      { role: UserRole.CLUB },
      { extraRoles: { has: UserRole.CLUB }, club: { disabledAt: null } },
    ],
  };
}

/** The only shape `extraRoles` is ever written in. */
export function normalizeExtraRoles(
  main: UserRole,
  extras: readonly UserRole[],
): UserRole[] {
  return inEnumOrder(extras.filter((r) => r !== main));
}
