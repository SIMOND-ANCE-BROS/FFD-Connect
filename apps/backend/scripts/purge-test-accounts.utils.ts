/**
 * Pure selection rules of scripts/purge-test-accounts.ts (kept separate so they
 * can be unit-tested without a database).
 *
 * Conservative on purpose: a real beta tester must never match. Only accounts
 * the staging seeds created are targeted, and the store-review account
 * (`isStoreReview`) is always kept.
 */

/**
 * Domain of every account the staging seeds created (profile switch,
 * beta-career partners, check-in scan targets, beta@test.com demo). `test.com`
 * is not a mailbox anyone receives mail on, so no real tester uses it.
 */
const TEST_EMAIL_DOMAIN = "@test.com";

/**
 * The store-review account given to Apple / Google. Kept by email too, not
 * only by flag: on the first boot after the flag's migration it is not
 * flagged yet (the purge runs before the seed that flags it), and deleting it
 * would change its id and end the reviewers' sessions.
 */
export const STORE_REVIEW_EMAIL = "licensee@test.com";

/** Fixed ids of seeded rows (`seed-scan-user-1`…). */
const SEED_ID_PREFIX = "seed-";

/** Clubs created by the staging seeds (exact names, case-insensitive). */
export const TEST_CLUB_NAMES: readonly string[] = ["Club Démo Bêta"];

/** Club of the store-review account (seed-profile-test-accounts.ts): kept. */
export const STORE_REVIEW_CLUB_NAME = "Club Test FFD";

/** License numbers created by the staging seeds for the purged accounts. */
const TEST_LICENSE_NUMBER = /^(SCAN-TEST-\d+|BETA-EXPIRY-TEST)$/;

export interface PurgeUserCandidate {
  id: string;
  email: string;
  isStoreReview: boolean;
}

export interface PurgeClubCandidate {
  id: string;
  name: string;
  isStoreReview: boolean;
  /** Ids of every account attached to the club (User.clubId). */
  memberIds: readonly string[];
}

export function isTestUser(user: PurgeUserCandidate): boolean {
  const email = user.email.trim().toLowerCase();
  if (user.isStoreReview || email === STORE_REVIEW_EMAIL) return false;
  return (
    email.endsWith(TEST_EMAIL_DOMAIN) || user.id.startsWith(SEED_ID_PREFIX)
  );
}

export function selectTestUsers<T extends PurgeUserCandidate>(
  users: readonly T[],
): T[] {
  return users.filter(isTestUser);
}

const TEST_CLUB_NAME_SET = new Set(
  TEST_CLUB_NAMES.map((n) => n.toLocaleLowerCase("fr")),
);

/**
 * A seeded club goes only when none of its members survives the purge: a club
 * a real account was attached to (by hand, or a tester who picked it) stays.
 */
export function selectTestClubs<T extends PurgeClubCandidate>(
  clubs: readonly T[],
  purgedUserIds: ReadonlySet<string>,
): T[] {
  return clubs.filter(
    (club) =>
      !club.isStoreReview &&
      TEST_CLUB_NAME_SET.has(club.name.trim().toLocaleLowerCase("fr")) &&
      club.memberIds.every((id) => purgedUserIds.has(id)),
  );
}

/**
 * Seeded licenses of purged accounts are deleted too, so nobody can claim
 * them at registration. Any other license (a real tester's number from
 * seed-beta-testers, a federation import) is kept and simply unlinked.
 */
export function isTestLicenseNumber(number: string): boolean {
  return TEST_LICENSE_NUMBER.test(number.trim());
}
