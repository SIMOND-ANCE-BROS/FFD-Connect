/**
 * Purge of the TEST accounts and TEST clubs created by the staging seeds.
 *
 * Staging now keeps a single test account: the store-review account
 * (STORE_REVIEW_EMAIL, `isStoreReview`) given to Apple / Google, and its club
 * (STORE_REVIEW_CLUB_NAME). A duplicate of it — a `licensee@test.com` or a
 * "Club Test FFD" recreated by an image older than #348 — goes too (#473).
 * Everything else the seeds created goes: club@/staff@/
 * admin@test.com, the beta@test.com demo, the beta-career partners
 * (partner-*@test.com) and their "Club Démo Bêta", the check-in scan targets
 * (seed-scan-user-*). Selection rules: purge-test-accounts.utils.ts — never a
 * real beta tester (they do not use @test.com nor seeded ids).
 *
 * Per account, in one transaction: seeded licenses (SCAN-TEST-*,
 * BETA-EXPIRY-TEST) are deleted and their numbers retired (#491: a QR bound
 * to the number alone never designates a license created later with it; any
 * other license is only unlinked, Prisma SetNull), then the SAME deletion core as AccountDeletionService
 * (src/users/account-deletion.core.ts, #412) runs: competition results
 * anonymised (DELETED_USER_ID tombstone), rows without cascade deleted,
 * partner registrations, partners' copies of the name (#395) and admin
 * audit rows anonymised, user row deleted.
 * After the commit, the account's renewal document files (medical
 * certificates) are deleted from storage, best-effort, with the same
 * RenewalDocumentFileCleaner as AccountDeletionService (#430).
 * Clubs go last, once none of their members survives. Then results already
 * orphaned by earlier purges are anonymised (idempotent sweep).
 * Not done here (no Redis client in the script): results cache invalidation
 * (1 h TTL).
 *
 * Logs name accounts by id only, never by e-mail (#430).
 *
 * Idempotent: nothing to purge = no-op. `--dry-run` lists without deleting.
 * Run at container boot (docker-entrypoint.sh) ONLY when SEED_TEST_TRACKS=true
 * — never in prod — BEFORE seed-profile-test-accounts (which flags the
 * store-review account). A failure never blocks the boot.
 */
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import { CircuitBreakerService } from "../src/common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "../src/storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../src/storage/renewal-document-file-cleaner.service";
import { anonymizeOrphanedResults } from "../src/users/account-deletion.core";
import {
  LEGACY_STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
  TEST_CLUB_NAMES,
  formatPurgeSummary,
  formatUserPurged,
  pickStoreReviewAccount,
  purgeTestUser,
  selectTestClubs,
  selectTestUsers,
} from "./purge-test-accounts.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = "🧹 [purge-test-accounts]";
/** Staging holds a few dozen accounts; the cap only bounds the read. */
const MAX_CANDIDATES = 500;
/** Flagged accounts + holder of the new address: one, a few if duplicated. */
const MAX_STORE_REVIEW_CANDIDATES = 20;

// Same storage cleaner as AccountDeletionService (circuit breaker + timeout,
// best-effort). Outside Nest DI: ConfigService without a module reads the
// process environment, like the app's ConfigModule does.
const renewalFiles = new RenewalDocumentFileCleaner(
  new BlobStorageService(new ConfigService()),
  new CircuitBreakerService(),
);

async function purgeUser(userId: string): Promise<void> {
  const report = await purgeTestUser(
    {
      prisma,
      files: renewalFiles,
      warn: (message) => console.warn(`${TAG}   ⚠ ${message}`),
    },
    userId,
  );
  console.log(`${TAG} ${formatUserPurged(userId, report)}`);
}

/**
 * Results already orphaned by purges that predate #412 (the #396 data
 * migration ran once, and later purges kept leaving rows behind). Idempotent:
 * nothing to do = one read.
 */
async function sweepOrphanedResults(): Promise<void> {
  if (DRY_RUN) return;
  try {
    const count = await anonymizeOrphanedResults(prisma);
    if (count > 0) {
      console.log(`${TAG} Anonymised ${count} orphaned result(s).`);
    }
  } catch (error) {
    console.warn(
      `${TAG}   ⚠ orphaned results: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await purgeAccounts();
  await sweepOrphanedResults();
}

/** Id of the one store-review account the purge keeps (null: none yet). */
async function findKeptStoreReviewId(): Promise<string | null> {
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { isStoreReview: true },
        { email: { equals: STORE_REVIEW_EMAIL, mode: "insensitive" } },
      ],
    },
    select: { id: true, email: true, isStoreReview: true },
    orderBy: { createdAt: "asc" },
    take: MAX_STORE_REVIEW_CANDIDATES,
  });
  return pickStoreReviewAccount(rows)?.id ?? null;
}

async function purgeAccounts(): Promise<void> {
  const keptStoreReviewId = await findKeptStoreReviewId();
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: "@test.com", mode: "insensitive" } },
        { id: { startsWith: "seed-" } },
      ],
    },
    select: { id: true, email: true, isStoreReview: true },
    orderBy: { email: "asc" },
    take: MAX_CANDIDATES,
  });
  const users = selectTestUsers(candidates, keptStoreReviewId);
  const purgedIds = new Set(users.map((u) => u.id));

  const clubRows = await prisma.club.findMany({
    where: {
      // The store-review club names are read so selectTestClubs can tell a
      // legacy leftover from the club the seed is about to rename.
      OR: [
        ...TEST_CLUB_NAMES,
        STORE_REVIEW_CLUB_NAME,
        LEGACY_STORE_REVIEW_CLUB_NAME,
      ].map((name) => ({
        name: { equals: name, mode: "insensitive" as const },
      })),
    },
    select: {
      id: true,
      name: true,
      isStoreReview: true,
      members: { select: { id: true }, take: MAX_CANDIDATES },
    },
    take: 50,
  });
  const clubs = selectTestClubs(
    clubRows.map((c) => ({ ...c, memberIds: c.members.map((m) => m.id) })),
    purgedIds,
  );

  if (users.length === 0 && clubs.length === 0) {
    console.log(`${TAG} Nothing to purge.`);
    return;
  }

  const kept = candidates.filter((c) => !purgedIds.has(c.id));
  for (const line of formatPurgeSummary({
    dryRun: DRY_RUN,
    userIds: users.map((u) => u.id),
    clubs,
    keptUserIds: kept.map((k) => k.id),
  })) {
    console.log(`${TAG} ${line}`);
  }
  if (DRY_RUN) return;

  let failures = 0;
  for (const u of users) {
    try {
      await purgeUser(u.id);
    } catch (error) {
      failures++;
      console.warn(
        `${TAG}   ⚠ user ${u.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const c of clubs) {
    try {
      // Cascades: partnerships and solo teams of the club; members SetNull.
      await prisma.club.delete({ where: { id: c.id }, select: { id: true } });
      console.log(`${TAG}   ✓ club ${c.name} (${c.id})`);
    } catch (error) {
      failures++;
      console.warn(
        `${TAG}   ⚠ club ${c.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    `${TAG} Done: ${users.length + clubs.length - failures} deleted, ${failures} failure(s).`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(`❌ [purge-test-accounts] Failed:`, error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
    void pool.end();
  });
