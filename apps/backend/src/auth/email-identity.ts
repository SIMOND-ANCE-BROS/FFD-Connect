import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { idOnlySelect, userIdEmailSelect } from "../utils/prisma-selects";

/**
 * Login addresses are case-insensitive (#465): every account email is stored
 * and looked up in this single form — trimmed, ASCII letters lower-cased.
 *
 * ASCII only on purpose: full Unicode folding (`toLowerCase`) maps look-alikes
 * such as the Kelvin sign "K" (U+212A) onto "k", which would let a different
 * string designate someone else's account, and it does not agree with
 * PostgreSQL's own folding. Non-ASCII characters are compared as typed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** `@Transform` for DTO email fields: normalises strings, leaves the rest to the validators. */
export const normalizeEmailTransform = ({
  value,
}: {
  value: unknown;
}): unknown => (typeof value === "string" ? normalizeEmail(value) : value);

/**
 * Escapes the LIKE metacharacters (`\`, `%`, `_`): Prisma compiles
 * `{ equals, mode: "insensitive" }` to `ILIKE` on PostgreSQL, where they would
 * otherwise act as wildcards (`%@exemple.fr` matching anyone's address).
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type UserLookupClient = Pick<Prisma.TransactionClient, "user">;

/**
 * Upper bound of legacy rows read by the case-insensitive fallback. Above 1
 * means ambiguous anyway; a little headroom keeps a row rejected by the
 * application-side recheck from hiding a genuine match.
 */
const LEGACY_CANDIDATES_MAX = 5;

const logger = new Logger("EmailIdentity");

/**
 * Accounts whose stored email is `email` up to ASCII case and surrounding
 * spaces.
 *
 * Exact match on the normalised form first (unique index, the normal case).
 * Only on a miss, a bounded case-insensitive query covers accounts stored
 * before the address was normalised at write time. That query is a pre-filter
 * only (escaped pattern, PostgreSQL folding): each candidate is kept only if
 * its stored address normalises to exactly the same string, so the database's
 * matching rules can never widen who is designated.
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
  const candidates = await db.user.findMany({
    where: {
      email: { equals: escapeLikePattern(normalized), mode: "insensitive" },
    },
    select: userIdEmailSelect,
    take: LEGACY_CANDIDATES_MAX,
  });
  return candidates
    .filter((u) => normalizeEmail(u.email) === normalized)
    .map(({ id }) => ({ id }));
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
