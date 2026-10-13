import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

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
 * `@IsEmail` options for STORED addresses: no UTF-8 local part. With
 * `@IsAscii` (internationalised domains must come in punycode), a stored
 * address only ever contains ASCII, the only characters folded by
 * `normalizeEmail`: no Unicode look-alike of an existing address (#465).
 */
export const STORED_EMAIL_OPTIONS = { allow_utf8_local_part: false } as const;
export const STORED_EMAIL_ASCII_MESSAGE =
  "L'adresse email ne doit contenir que des caractères ASCII (domaine internationalisé : forme punycode)";

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

type UserLookupClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Upper bound of the rows read for one address. Only addresses equal up to
 * ASCII case can match, and the write paths refuse any such collision, so
 * more than one row only happens with legacy duplicates.
 */
const CANDIDATES_MAX = 5;

const logger = new Logger("EmailIdentity");

/**
 * Every account whose stored address equals `email` up to ASCII case and
 * surrounding spaces — including legacy rows stored before addresses were
 * normalised at write time, and distinct accounts differing only by case.
 *
 * Compared in the database exactly like `normalizeEmail`: `lower()` under the
 * "C" collation folds ASCII letters only, so Unicode look-alikes (Kelvin sign,
 * dotted I…) never match and can never crowd the bounded result. Plain
 * equality, no LIKE: nothing in the address acts as a wildcard. The row typed
 * exactly comes first, so its owner is always in the result. Each row is
 * re-checked in the application as a last guard.
 */
async function emailCandidates(
  db: UserLookupClient,
  email: string,
  excludeUserId?: string,
): Promise<{ id: string; email: string }[]> {
  const typed = email.trim();
  const normalized = normalizeEmail(email);
  const rows = await db.$queryRaw<{ id: string; email: string }[]>(
    Prisma.sql`SELECT id, email FROM "User"
      WHERE lower(email COLLATE "C") = ${normalized}
      ${excludeUserId ? Prisma.sql`AND id <> ${excludeUserId}` : Prisma.empty}
      ORDER BY (email = ${typed}) DESC, id ASC
      LIMIT ${CANDIDATES_MAX}`,
  );
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
 * `excludeUserId`: the account being edited, which may keep its own address.
 */
export async function isEmailTaken(
  db: UserLookupClient,
  email: string,
  excludeUserId?: string,
): Promise<boolean> {
  return (await emailCandidates(db, email, excludeUserId)).length > 0;
}
