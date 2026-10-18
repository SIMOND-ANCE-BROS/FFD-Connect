/**
 * One-shot backfill of the per-discipline competition levels (#239, phase 1).
 *
 * `User.competitionLevel` (single level) is deprecated: the level is held per
 * discipline (`competitionLevelLatin` / `competitionLevelStandard`). The
 * 20261009150000 migration copied it once; rows written since by an older
 * revision (rollback) or an older back-office may still carry only the legacy
 * value, served through a read fallback. This script copies it into the
 * per-discipline levels for every user that has none, so the column can be
 * dropped in phase 2.
 *
 * Rule (planCompetitionLevelBackfill): guided by the declared discipline —
 * Latin → Latin level only, Standard → Standard level only, otherwise both.
 * A user with at least one per-discipline level is never touched.
 *
 * Idempotent (compare-and-set on both levels NULL), counts only in the logs.
 * Dry run by default (reports without writing); `--apply` writes.
 *
 * Run after the deploy (ops step, runbook
 * docs/exploitation/retrait-niveau-competition-unique.md), inside the backend
 * container:
 *   node dist/scripts/backfill-user-competition-level.js
 *   node dist/scripts/backfill-user-competition-level.js --apply
 * Locally: pnpm --filter backend exec tsx scripts/backfill-user-competition-level.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import { backfillUserCompetitionLevels } from "./backfill-user-competition-level.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Writes only on explicit request: a bare run is a dry run.
const DRY_RUN = !process.argv.includes("--apply");
const TAG = "🎚️ [backfill-user-competition-level]";

async function main(): Promise<void> {
  const r = await backfillUserCompetitionLevels(prisma, DRY_RUN);
  // Counts only: no names, no emails, no ids (the logs leave the database).
  console.log(
    `${TAG} ${DRY_RUN ? "[dry-run] " : ""}${r.scanned} user(s) with only the legacy level, ${r.updated} ${DRY_RUN ? "would be " : ""}backfilled (Latin only: ${r.latinOnly}, Standard only: ${r.standardOnly}, both: ${r.both}), ${r.skippedInvalid} skipped (unknown level value), ${r.skippedConcurrent} skipped (changed meanwhile).`,
  );
}

main()
  .catch((e: unknown) => {
    // Message only: a full Prisma error may echo row values.
    console.error(
      `${TAG} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
