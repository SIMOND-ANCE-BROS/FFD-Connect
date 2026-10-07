import { Prisma } from "@prisma/client";
import { idOnlySelect } from "../utils/prisma-selects";

/**
 * Field-level diff for the audit log: only keys present in `after` are
 * compared; values are compared by JSON form so Dates compare by instant.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

/** Account creations logged by the back-office (lot 1 used CLUB_ACCOUNT_CREATE). */
export const ADMIN_CREATION_ACTIONS = ["USER_CREATE", "CLUB_ACCOUNT_CREATE"];

/** True when the account was created from the back-office (has a creation audit row). */
export async function isCreatedByAdmin(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const row = await db.adminAuditLog.findFirst({
    where: {
      targetType: "USER",
      targetId: userId,
      action: { in: ADMIN_CREATION_ACTIONS },
    },
    select: idOnlySelect,
  });
  return row !== null;
}
