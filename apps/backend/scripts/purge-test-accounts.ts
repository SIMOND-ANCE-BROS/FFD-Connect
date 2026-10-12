/**
 * Purge of the TEST accounts and TEST clubs created by the staging seeds.
 *
 * Staging now keeps a single test account: the store-review account
 * (`isStoreReview`, STORE_REVIEW_EMAIL) given to Apple / Google, and its club
 * (STORE_REVIEW_CLUB_NAME). Everything else the seeds created goes: club@/staff@/
 * admin@test.com, the beta@test.com demo, the beta-career partners
 * (partner-*@test.com) and their "Club Démo Bêta", the check-in scan targets
 * (seed-scan-user-*). Selection rules: purge-test-accounts.utils.ts — never a
 * real beta tester (they do not use @test.com nor seeded ids).
 *
 * Per account, in one transaction: seeded licenses (SCAN-TEST-*,
 * BETA-EXPIRY-TEST) are deleted (any other license is only unlinked, Prisma
 * SetNull), then the SAME deletion core as AccountDeletionService
 * (src/users/account-deletion.core.ts, #412) runs: competition results
 * anonymised (DELETED_USER_ID tombstone), rows without cascade deleted,
 * partner registrations and admin audit rows anonymised, user row deleted.
 * Clubs go last, once none of their members survives. Then results already
 * orphaned by earlier purges are anonymised (idempotent sweep).
 * Not done here (no Redis / storage client in the script): results cache
 * invalidation (1 h TTL) and renewal document files.
 *
 * Idempotent: nothing to purge = no-op. `--dry-run` lists without deleting.
 * Run at container boot (docker-entrypoint.sh) ONLY when SEED_TEST_TRACKS=true
 * — never in prod — BEFORE seed-profile-test-accounts (which flags the
 * store-review account). A failure never blocks the boot.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  anonymizeOrphanedResults,
  findResultsToAnonymize,
} from "../src/users/account-deletion.core";
import {
  TEST_CLUB_NAMES,
  buildPurgeUserOperations,
  isTestLicenseNumber,
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

async function purgeUser(user: { id: string; email: string }): Promise<void> {
  const licenses = await prisma.license.findMany({
    where: { userId: user.id },
    select: { id: true, number: true },
    take: 10,
  });
  const seededLicenseIds = licenses
    .filter((l) => isTestLicenseNumber(l.number))
    .map((l) => l.id);

  const results = await findResultsToAnonymize(prisma, user.id);

  const [licensesDeleted] = (await prisma.$transaction(
    buildPurgeUserOperations(prisma, user.id, seededLicenseIds, results),
  )) as [Prisma.BatchPayload, ...unknown[]];
  const unlinked = licenses.length - licensesDeleted.count;
  console.log(
    `${TAG}   ✓ user ${user.email} (${user.id}): ${results.length} result(s) anonymised, ${licensesDeleted.count} seeded license(s) deleted, ${unlinked} license(s) unlinked`,
  );
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

async function purgeAccounts(): Promise<void> {
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
  const users = selectTestUsers(candidates);
  const purgedIds = new Set(users.map((u) => u.id));

  const clubRows = await prisma.club.findMany({
    where: {
      OR: TEST_CLUB_NAMES.map((name) => ({
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
  console.log(
    `${TAG} ${DRY_RUN ? "[dry-run] would delete" : "Deleting"} ${users.length} user(s) and ${clubs.length} club(s); keeping ${kept.map((k) => k.email).join(", ") || "none"}.`,
  );
  for (const u of users) console.log(`${TAG}   - user ${u.email} (${u.id})`);
  for (const c of clubs) console.log(`${TAG}   - club ${c.name} (${c.id})`);
  if (DRY_RUN) return;

  let failures = 0;
  for (const u of users) {
    try {
      await purgeUser(u);
    } catch (error) {
      failures++;
      console.warn(
        `${TAG}   ⚠ user ${u.email}: ${error instanceof Error ? error.message : String(error)}`,
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
