/**
 * Pure decision rules of scripts/seed-profile-test-accounts.ts (kept separate
 * so they can be unit-tested without a database).
 *
 * The store-review account is RENAMED in place, never recreated: its id, its
 * career demo data and the reviewers' sessions must survive a rename.
 */
import {
  LEGACY_STORE_REVIEW_CLUB_NAME,
  LEGACY_STORE_REVIEW_EMAIL,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";

export const STORE_REVIEW_FIRST_NAME = "Compte";
export const STORE_REVIEW_LAST_NAME = "Démo";

export interface StoreReviewUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isStoreReview: boolean;
}

const norm = (e: string) => e.trim().toLowerCase();

export type StoreReviewAccountDecision<T extends StoreReviewUserRow> =
  | { kind: "update"; user: T }
  | { kind: "create" }
  | { kind: "conflict"; ids: string[] };

/**
 * Only a FLAGGED (`isStoreReview`) account may be updated or elevated: the
 * seed grants ADMIN + every role, so adopting an unflagged account that merely
 * holds the target or legacy email would be account squatting. Unflagged
 * holder(s) of either email = conflict (nothing written); create only when the
 * flag and both emails are free.
 */
export function resolveStoreReviewAccount<T extends StoreReviewUserRow>(
  rows: readonly T[],
): StoreReviewAccountDecision<T> {
  const flagged = rows.find((r) => r.isStoreReview);
  if (flagged) return { kind: "update", user: flagged };
  const holders = rows.filter((r) =>
    [STORE_REVIEW_EMAIL, LEGACY_STORE_REVIEW_EMAIL].includes(norm(r.email)),
  );
  if (holders.length > 0) {
    return { kind: "conflict", ids: holders.map((h) => h.id) };
  }
  return { kind: "create" };
}

export type RenamePlan<D> =
  | { ok: true; data: Partial<D> }
  | { ok: false; error: string };

/**
 * Identity fields are rewritten only when migrating from the legacy email, so
 * a later back-office edit of the name/email is not reset at every boot.
 * `emailHolder` is whoever owns the target email (unique constraint): another
 * user = conflict, nothing is written.
 */
export function planUserRename(
  existing: Pick<StoreReviewUserRow, "id" | "email">,
  emailHolder: { id: string } | null,
): RenamePlan<{ email: string; firstName: string; lastName: string }> {
  if (norm(existing.email) !== LEGACY_STORE_REVIEW_EMAIL) {
    return { ok: true, data: {} };
  }
  if (emailHolder && emailHolder.id !== existing.id) {
    return {
      ok: false,
      error: `${STORE_REVIEW_EMAIL} already belongs to another user (${emailHolder.id}); store-review account ${existing.id} not renamed.`,
    };
  }
  return {
    ok: true,
    data: {
      email: STORE_REVIEW_EMAIL,
      firstName: STORE_REVIEW_FIRST_NAME,
      lastName: STORE_REVIEW_LAST_NAME,
    },
  };
}

export interface StoreReviewClubRow {
  id: string;
  name: string;
  isStoreReview: boolean;
}

/**
 * Flagged club first; otherwise, among unflagged clubs carrying the target or
 * legacy name, the one already holding the target name.
 */
export function pickStoreReviewClub<T extends StoreReviewClubRow>(
  rows: readonly T[],
): T | null {
  return (
    rows.find((r) => r.isStoreReview) ??
    rows.find((r) => r.name === STORE_REVIEW_CLUB_NAME) ??
    rows.find((r) => r.name === LEGACY_STORE_REVIEW_CLUB_NAME) ??
    null
  );
}

/**
 * Rename the club only when it still carries the legacy name, unless another
 * club already holds the target name (unique constraint). A conflict is
 * reported but must not stop the account work: the club keeps its name.
 */
export function planClubRename(
  club: { id: string; name: string },
  nameHolder: { id: string } | null,
): RenamePlan<{ name: string }> {
  if (club.name !== LEGACY_STORE_REVIEW_CLUB_NAME) {
    return { ok: true, data: {} };
  }
  if (nameHolder && nameHolder.id !== club.id) {
    return {
      ok: false,
      error: `A club named "${STORE_REVIEW_CLUB_NAME}" already exists (${nameHolder.id}); store-review club ${club.id} keeps its name.`,
    };
  }
  return { ok: true, data: { name: STORE_REVIEW_CLUB_NAME } };
}

/** Club names the seed accepts when looking the club up by name (no flag). */
export const STORE_REVIEW_CLUB_LOOKUP_NAMES: readonly string[] = [
  STORE_REVIEW_CLUB_NAME,
  LEGACY_STORE_REVIEW_CLUB_NAME,
];

/**
 * The password follows the server secret: rotate only when the secret is set
 * and no longer matches the stored hash. Unset secret = account untouched.
 */
export function planPasswordUpdate(
  secret: string | undefined,
  secretMatchesStoredHash: boolean,
): "rotate" | "keep" {
  if (!secret) return "keep";
  return secretMatchesStoredHash ? "keep" : "rotate";
}
