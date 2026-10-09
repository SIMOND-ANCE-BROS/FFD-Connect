/**
 * Purge of the TEST accounts and TEST clubs created by the staging seeds.
 *
 * Staging now keeps a single test account: the store-review account
 * (licensee@test.com, `isStoreReview`) given to Apple / Google, and its club
 * "Club Test FFD". Everything else the seeds created goes: club@/staff@/
 * admin@test.com, the beta@test.com demo, the beta-career partners
 * (partner-*@test.com) and their "Club Démo Bêta", the check-in scan targets
 * (seed-scan-user-*). Selection rules: purge-test-accounts.utils.ts — never a
 * real beta tester (they do not use @test.com nor seeded ids).
 *
 * Per account, in one transaction (same core as AccountDeletionService):
 * rows without cascade (registrations, seat bookings, notifications, bug
 * reports) are deleted, registrations naming the account as partner are
 * anonymised, seeded licenses (SCAN-TEST-*, BETA-EXPIRY-TEST) are deleted
 * while any other license is only unlinked (Prisma SetNull), then the user
 * row goes (cascades: tokens, partnerships, solo-team memberships, renewal
 * requests, notification preferences, device tokens). Clubs go last, once
 * none of their members survives.
 *
 * Idempotent: nothing to purge = no-op. `--dry-run` lists without deleting.
 * Run at container boot (docker-entrypoint.sh) ONLY when SEED_TEST_TRACKS=true
 * — never in prod — BEFORE seed-profile-test-accounts (which flags the
 * store-review account). A failure never blocks the boot.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  TEST_CLUB_NAMES,
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

  const [notifications, seats, registrations, , , , licensesDeleted] =
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId: user.id } }),
      prisma.seatBooking.deleteMany({ where: { userId: user.id } }),
      prisma.registration.deleteMany({ where: { userId: user.id } }),
      prisma.registration.updateMany({
        where: { partnerUserId: user.id },
        data: { partnerUserId: null, partnerName: null },
      }),
      prisma.trackCorrection.updateMany({
        where: { proposedById: user.id },
        data: { message: null },
      }),
      prisma.bugReport.deleteMany({ where: { userId: user.id } }),
      prisma.license.deleteMany({ where: { id: { in: seededLicenseIds } } }),
      prisma.user.delete({ where: { id: user.id }, select: { id: true } }),
    ]);
  const unlinked = licenses.length - licensesDeleted.count;
  console.log(
    `${TAG}   ✓ user ${user.email} (${user.id}): ${registrations.count} registration(s), ${seats.count} seat booking(s), ${notifications.count} notification(s), ${licensesDeleted.count} seeded license(s) deleted, ${unlinked} license(s) unlinked`,
  );
}

async function main(): Promise<void> {
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
