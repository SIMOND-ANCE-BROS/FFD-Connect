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

/**
 * Picks the existing account: flag first, then the target email, then the
 * legacy email. `null` = nothing to rename (create, or skip).
 */
export function pickStoreReviewUser<T extends StoreReviewUserRow>(
  rows: readonly T[],
): T | null {
  const norm = (e: string) => e.trim().toLowerCase();
  return (
    rows.find((r) => r.isStoreReview) ??
    rows.find((r) => norm(r.email) === STORE_REVIEW_EMAIL) ??
    rows.find((r) => norm(r.email) === LEGACY_STORE_REVIEW_EMAIL) ??
    null
  );
}

export type RenamePlan<D> =
  | { ok: true; data: Partial<D> }
  | { ok: false; error: string };

/**
 * Fields to rewrite on the existing account so it matches the target identity.
 * `emailHolder` is whoever currently owns the target email (unique constraint):
 * another user = conflict, nothing is written.
 */
export function planUserRename(
  existing: Pick<StoreReviewUserRow, "id" | "email" | "firstName" | "lastName">,
  emailHolder: { id: string } | null,
): RenamePlan<{ email: string; firstName: string; lastName: string }> {
  const data: Partial<{ email: string; firstName: string; lastName: string }> =
    {};
  if (existing.email !== STORE_REVIEW_EMAIL) {
    if (emailHolder && emailHolder.id !== existing.id) {
      return {
        ok: false,
        error: `${STORE_REVIEW_EMAIL} already belongs to another user (${emailHolder.id}); store-review account ${existing.id} not renamed.`,
      };
    }
    data.email = STORE_REVIEW_EMAIL;
  }
  if (existing.firstName !== STORE_REVIEW_FIRST_NAME) {
    data.firstName = STORE_REVIEW_FIRST_NAME;
  }
  if (existing.lastName !== STORE_REVIEW_LAST_NAME) {
    data.lastName = STORE_REVIEW_LAST_NAME;
  }
  return { ok: true, data };
}

/**
 * Club found by flag (or legacy name): rename it to the target name unless
 * another club already holds that name (unique constraint).
 */
export function planClubRename(
  club: { id: string; name: string },
  nameHolder: { id: string } | null,
): RenamePlan<{ name: string }> {
  if (club.name === STORE_REVIEW_CLUB_NAME) return { ok: true, data: {} };
  if (nameHolder && nameHolder.id !== club.id) {
    return {
      ok: false,
      error: `A club named "${STORE_REVIEW_CLUB_NAME}" already exists (${nameHolder.id}); store-review club ${club.id} not renamed.`,
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
