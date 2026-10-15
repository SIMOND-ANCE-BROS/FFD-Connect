import { Prisma, UserRole } from "@prisma/client";
import { notifiableAccountWhere } from "../auth/account-status";
import { withActiveRole } from "../auth/roles";

/**
 * Upper bound of the administrators read to be notified of a moderation
 * event (track correction, licence renewal to review). Shared so that every
 * admin fan-out stays bounded the same way.
 */
export const MAX_ADMINS_NOTIFIED = 100;

/**
 * The administrators to notify of a moderation event: effective ADMIN role,
 * account still allowed to act (#301). Shared so that no admin fan-out
 * forgets the account status. `AND` keeps both `OR` clauses apart.
 */
export function adminRecipientsWhere(): Prisma.UserWhereInput {
  return { AND: [withActiveRole(UserRole.ADMIN), notifiableAccountWhere] };
}

/**
 * Oldest accounts first, so that the subset bounded by
 * {@link MAX_ADMINS_NOTIFIED} is deterministic.
 */
export const adminRecipientsOrderBy = [
  { createdAt: "asc" },
  { id: "asc" },
] as const satisfies Prisma.UserOrderByWithRelationInput[];
