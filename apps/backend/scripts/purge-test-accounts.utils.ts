/**
 * Selection rules, per-account purge and log lines of
 * scripts/purge-test-accounts.ts (kept separate so they can be unit-tested
 * without a database).
 *
 * Conservative on purpose: a real beta tester must never match. Only accounts
 * the staging seeds created are targeted, and ONE store-review account is
 * always kept (pickStoreReviewAccount): the holder of STORE_REVIEW_EMAIL, or,
 * before the in-place rename, the flagged account the seed will rename. Any
 * other flagged `@test.com` account — a `licensee@test.com` recreated by an
 * image older than #348 — is a duplicate and is purged (#473).
 */
import { Prisma, PrismaClient } from "@prisma/client";
import type { RenewalDocumentFileCleaner } from "../src/storage/renewal-document-file-cleaner.service";
import {
  AccountDeletionPlan,
  AccountDeletionPrisma,
  buildAccountDeletionOperations,
  prepareAccountDeletion,
} from "../src/users/account-deletion.core";
import { licenseRenewalDocumentFileSelect } from "../src/utils/prisma-selects";

/**
 * Domain of every account the staging seeds created (profile switch,
 * beta-career partners, check-in scan targets, beta@test.com demo). `test.com`
 * is not a mailbox anyone receives mail on, so no real tester uses it.
 */
const TEST_EMAIL_DOMAIN = "@test.com";

/**
 * The store-review account given to Apple / Google. The purge never deletes
 * the holder of this address, flagged or not: deleting it would change its id
 * and end the reviewers' sessions.
 */
export const STORE_REVIEW_EMAIL = "demo@ffd.gabin-simond.fr";

/**
 * Former email of the account (#347). NOT protected by the purge any more
 * (#473): images older than #348 recreate it when they boot, so once the
 * account carries the new address a `licensee@test.com` is a duplicate and
 * goes like any other `@test.com` account. Still used by the seed to rename a
 * flagged account that was never migrated.
 */
export const LEGACY_STORE_REVIEW_EMAIL = "licensee@test.com";

/** Fixed ids of seeded rows (`seed-scan-user-1`…). */
const SEED_ID_PREFIX = "seed-";

/** Clubs created by the staging seeds (exact names, case-insensitive). */
export const TEST_CLUB_NAMES: readonly string[] = ["Club Démo Bêta"];

/** Club of the store-review account (seed-profile-test-accounts.ts): kept. */
export const STORE_REVIEW_CLUB_NAME = "Club Démo FFD Connect";

/**
 * Former club name, looked up by the seed to rename the club in place. Once a
 * club carries the new name, a club still named like this is a leftover of an
 * image older than #348 and is purged (selectTestClubs, #473).
 */
export const LEGACY_STORE_REVIEW_CLUB_NAME = "Club Test FFD";

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

const norm = (email: string) => email.trim().toLowerCase();

export function isStoreReviewEmail(email: string): boolean {
  return norm(email) === STORE_REVIEW_EMAIL;
}

/**
 * THE store-review account, among the flagged accounts and the holder(s) of
 * STORE_REVIEW_EMAIL, given in creation order (oldest first). Shared by the
 * purge (the one account it keeps) and the seed (the one account it updates):
 * 1. the flagged holder of the new address (normal state);
 * 2. otherwise the oldest flagged account (not migrated yet, or its address
 *    edited from the back-office): the seed renames / updates it in place;
 * 3. otherwise the unflagged holder of the new address (the seed reports it
 *    as a conflict — never elevated — and the purge keeps it).
 */
export function pickStoreReviewAccount<T extends PurgeUserCandidate>(
  rows: readonly T[],
): T | null {
  return (
    rows.find((r) => r.isStoreReview && isStoreReviewEmail(r.email)) ??
    rows.find((r) => r.isStoreReview) ??
    rows.find((r) => isStoreReviewEmail(r.email)) ??
    null
  );
}

/**
 * `keptStoreReviewId` is the id pickStoreReviewAccount chose (null: none). A
 * flagged account is NOT protected by its flag alone: only the chosen one and
 * the holder of STORE_REVIEW_EMAIL are, so a duplicate flagged `@test.com`
 * account (e.g. a recreated `licensee@test.com`) is purged (#473).
 */
export function isTestUser(
  user: PurgeUserCandidate,
  keptStoreReviewId: string | null,
): boolean {
  if (user.id === keptStoreReviewId || isStoreReviewEmail(user.email)) {
    return false;
  }
  return (
    norm(user.email).endsWith(TEST_EMAIL_DOMAIN) ||
    user.id.startsWith(SEED_ID_PREFIX)
  );
}

export function selectTestUsers<T extends PurgeUserCandidate>(
  users: readonly T[],
  keptStoreReviewId: string | null,
): T[] {
  return users.filter((u) => isTestUser(u, keptStoreReviewId));
}

const TEST_CLUB_NAME_SET = new Set(
  TEST_CLUB_NAMES.map((n) => n.toLocaleLowerCase("fr")),
);

const normClub = (name: string) => name.trim().toLocaleLowerCase("fr");

/**
 * A seeded club goes only when none of its members survives the purge: a club
 * a real account was attached to (by hand, or a tester who picked it) stays.
 * The store-review club (flagged) is kept, except a club still carrying the
 * LEGACY name while another club already holds the new one: that is a
 * leftover recreated by an image older than #348 (#473). Without a club named
 * STORE_REVIEW_CLUB_NAME the legacy club is the one the seed renames: kept.
 */
export function selectTestClubs<T extends PurgeClubCandidate>(
  clubs: readonly T[],
  purgedUserIds: ReadonlySet<string>,
): T[] {
  const storeReviewClubExists = clubs.some(
    (c) => normClub(c.name) === normClub(STORE_REVIEW_CLUB_NAME),
  );
  const isLegacyLeftover = (club: T) =>
    storeReviewClubExists &&
    normClub(club.name) === normClub(LEGACY_STORE_REVIEW_CLUB_NAME);
  return clubs.filter(
    (club) =>
      (isLegacyLeftover(club) ||
        (!club.isStoreReview && TEST_CLUB_NAME_SET.has(normClub(club.name)))) &&
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

export type PurgeUserPrisma = AccountDeletionPrisma &
  Pick<PrismaClient, "license">;

/**
 * Transaction of one purged account: the purge's own step (seeded licenses
 * deleted, first so the count is the first result) followed by the SAME
 * deletion core as AccountDeletionService (#412) — results anonymised with
 * the DELETED_USER_ID tombstone, partners' copies of the name scrubbed
 * (#395), admin audit rows stripped, user row deleted
 * last. Never re-list the user's relations here.
 */
export function buildPurgeUserOperations(
  prisma: PurgeUserPrisma,
  userId: string,
  seededLicenseIds: readonly string[],
  plan: AccountDeletionPlan,
): ReturnType<typeof buildAccountDeletionOperations> {
  return [
    prisma.license.deleteMany({ where: { id: { in: [...seededLicenseIds] } } }),
    ...buildAccountDeletionOperations(prisma, userId, plan),
  ];
}

/** A test account has at most a couple of licenses. */
const MAX_LICENSES_PER_USER = 10;

/**
 * Bound of the renewal document read (same as AccountDeletionService: a
 * draft holds at most one document per type, a few requests a season).
 */
export const MAX_RENEWAL_DOCUMENTS_PER_USER = 200;

/** What one account purge did (counts only: no personal data). */
export interface UserPurgeReport {
  resultsAnonymised: number;
  partnerNameCopiesScrubbed: number;
  seededLicensesDeleted: number;
  licensesUnlinked: number;
  renewalFilesDeleted: number;
  renewalFilesFailed: number;
}

export interface PurgeUserDeps {
  prisma: PrismaClient;
  /** RenewalDocumentFileCleaner: best-effort, never throws (#430). */
  files: Pick<RenewalDocumentFileCleaner, "deleteFiles">;
  warn: (message: string) => void;
}

/**
 * Purges one test account. Reads first (licenses, renewal document file
 * references — the cascade deletes their rows —, the deletion plan), then
 * ONE transaction, then the renewal document files (medical certificate:
 * health data, GDPR art. 9) are deleted from storage AFTER the commit,
 * best-effort, exactly like AccountDeletionService: a storage failure never
 * rolls back the purge; RenewalDocumentFileCleaner logs the blob reference
 * only (no personal data) for manual cleanup.
 */
export async function purgeTestUser(
  deps: PurgeUserDeps,
  userId: string,
): Promise<UserPurgeReport> {
  const { prisma } = deps;
  const licenses = await prisma.license.findMany({
    where: { userId },
    select: { id: true, number: true },
    take: MAX_LICENSES_PER_USER,
  });
  const seededLicenseIds = licenses
    .filter((l) => isTestLicenseNumber(l.number))
    .map((l) => l.id);
  const documents = await prisma.licenseRenewalDocument.findMany({
    where: { request: { userId } },
    select: licenseRenewalDocumentFileSelect,
    take: MAX_RENEWAL_DOCUMENTS_PER_USER,
  });
  if (documents.length === MAX_RENEWAL_DOCUMENTS_PER_USER) {
    deps.warn(
      `renewal document read hit the ${MAX_RENEWAL_DOCUMENTS_PER_USER} cap — remaining files may be orphaned, run scripts/list-orphan-renewal-blobs.ts`,
    );
  }
  const plan = await prepareAccountDeletion(prisma, userId, {
    warn: deps.warn,
  });

  const [licensesDeleted] = (await prisma.$transaction(
    buildPurgeUserOperations(prisma, userId, seededLicenseIds, plan),
  )) as [Prisma.BatchPayload, ...unknown[]];

  const filePaths = documents.map((d) => d.filePath);
  const deleted = await deps.files.deleteFiles(filePaths, "account-deletion");

  return {
    resultsAnonymised: plan.results.length,
    partnerNameCopiesScrubbed: plan.partnerNameScrub.ops.length,
    seededLicensesDeleted: licensesDeleted.count,
    licensesUnlinked: licenses.length - licensesDeleted.count,
    renewalFilesDeleted: deleted.size,
    renewalFilesFailed: filePaths.length - deleted.size,
  };
}

/**
 * Log lines of the purge: accounts are named by their technical id only,
 * never by e-mail (#430) — the output goes to the staging logs.
 */
export function formatPurgeSummary(o: {
  dryRun: boolean;
  userIds: readonly string[];
  clubs: readonly { id: string; name: string }[];
  keptUserIds: readonly string[];
}): string[] {
  return [
    `${o.dryRun ? "[dry-run] would delete" : "Deleting"} ${o.userIds.length} user(s) and ${o.clubs.length} club(s); keeping ${o.keptUserIds.length} candidate account(s)${o.keptUserIds.length > 0 ? ` (${o.keptUserIds.join(", ")})` : ""}.`,
    ...o.userIds.map((id) => `  - user ${id}`),
    // Club names are seeded fixtures (TEST_CLUB_NAMES), not personal data.
    ...o.clubs.map((c) => `  - club ${c.name} (${c.id})`),
  ];
}

export function formatUserPurged(userId: string, r: UserPurgeReport): string {
  return `  ✓ user ${userId}: ${r.resultsAnonymised} result(s) anonymised, ${r.partnerNameCopiesScrubbed} partner name copy(ies) scrubbed, ${r.seededLicensesDeleted} seeded license(s) deleted, ${r.licensesUnlinked} license(s) unlinked, ${r.renewalFilesDeleted} renewal file(s) deleted${r.renewalFilesFailed > 0 ? `, ${r.renewalFilesFailed} renewal file deletion(s) FAILED (see errors above)` : ""}`;
}
