import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { userIdEmailSelect } from "../utils/prisma-selects";

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

/**
 * `@Transform` for e-mails that are STORED (registration, admin creation or
 * edit): normalises strings, leaves the rest to the validators.
 */
export const normalizeEmailTransform = ({
  value,
}: {
  value: unknown;
}): unknown => (typeof value === "string" ? normalizeEmail(value) : value);

/**
 * `@Transform` for e-mails used to LOOK UP an account (login, forgot password,
 * impersonation): trims only. The casing as typed is kept so that, when legacy
 * accounts differ only by case, the exact one can still be told apart.
 */
export const trimEmailTransform = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

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
 * Upper bound of the rows read for one address. Above 1 is already a case
 * collision; a little headroom keeps a row rejected by the application-side
 * recheck from hiding a genuine match.
 */
const CANDIDATES_MAX = 5;

const logger = new Logger("EmailIdentity");

/**
 * Every account whose stored address is `email` up to ASCII case and
 * surrounding spaces — including legacy rows stored before addresses were
 * normalised at write time, and distinct accounts differing only by case.
 *
 * The case-insensitive query is a pre-filter only (escaped pattern,
 * PostgreSQL folding): a row is kept only if its stored address normalises to
 * exactly the same string, so the database's matching rules can never widen
 * who is designated.
 */
async function emailCandidates(
  db: UserLookupClient,
  email: string,
): Promise<{ id: string; email: string }[]> {
  const normalized = normalizeEmail(email);
  const rows = await db.user.findMany({
    where: {
      email: { equals: escapeLikePattern(normalized), mode: "insensitive" },
    },
    select: userIdEmailSelect,
    orderBy: { id: "asc" },
    take: CANDIDATES_MAX,
  });
  return rows.filter((u) => normalizeEmail(u.email) === normalized);
}

/**
 * The account an address designates, whatever its casing / surrounding
 * spaces. Deterministic and never merges two identities:
 * - one matching account: that one;
 * - several accounts differing only by case: only the one stored exactly as
 *   typed (trimmed); none such → `null`, logged for ops.
 * Callers keep their generic answer on `null` (no enumeration).
 */
export async function findUserIdByEmail(
  db: UserLookupClient,
  email: string,
): Promise<string | null> {
  const candidates = await emailCandidates(db, email);
  if (candidates.length <= 1) return candidates[0]?.id ?? null;

  const typed = email.trim();
  const exact = candidates.find((u) => u.email === typed);
  if (exact) return exact.id;
  logger.warn(
    `Accounts ${candidates.map((u) => u.id).join(", ")} share an email differing only by case: lookup refused`,
  );
  return null;
}

/**
 * Whether an address is already used by an account, whatever its casing: a
 * new or edited address never collides with an existing one once normalised.
 */
export async function isEmailTaken(
  db: UserLookupClient,
  email: string,
): Promise<boolean> {
  return (await emailCandidates(db, email)).length > 0;
}
