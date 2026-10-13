import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { idOnlySelect } from "../utils/prisma-selects";

/**
 * Login addresses are case-insensitive (#465): every account email is stored
 * and looked up in this single form — trimmed, lower-case.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `@Transform` for DTO email fields: normalises strings, leaves the rest to the validators. */
export const normalizeEmailTransform = ({
  value,
}: {
  value: unknown;
}): unknown => (typeof value === "string" ? normalizeEmail(value) : value);

type UserLookupClient = Pick<Prisma.TransactionClient, "user">;

const logger = new Logger("EmailIdentity");

/**
 * Accounts whose stored email matches `email` regardless of case (at most 2).
 *
 * Exact match on the normalised form first (unique index, the normal case).
 * Only on a miss, a case-insensitive match covers accounts stored before the
 * address was normalised at write time.
 */
async function matchingUserIds(
  db: UserLookupClient,
  email: string,
): Promise<{ id: string }[]> {
  const normalized = normalizeEmail(email);
  const exact = await db.user.findUnique({
    where: { email: normalized },
    select: idOnlySelect,
  });
  if (exact) return [exact];
  return db.user.findMany({
    where: { email: { equals: normalized, mode: "insensitive" } },
    select: idOnlySelect,
    take: 2,
  });
}

/**
 * The account an address designates, whatever its casing / surrounding
 * spaces. `null` when none — or when several legacy accounts differ only by
 * case: refusing beats picking one at random (never acts on someone else's
 * account). Callers keep their generic answer either way (no enumeration).
 */
export async function findUserIdByEmail(
  db: UserLookupClient,
  email: string,
): Promise<string | null> {
  const ids = await matchingUserIds(db, email);
  if (ids.length > 1) {
    logger.warn(
      `Accounts ${ids.map((u) => u.id).join(", ")} share an email differing only by case: lookup refused`,
    );
    return null;
  }
  return ids[0]?.id ?? null;
}

/** Whether an address is already used by an account, whatever its casing. */
export async function isEmailTaken(
  db: UserLookupClient,
  email: string,
): Promise<boolean> {
  return (await matchingUserIds(db, email)).length > 0;
}
