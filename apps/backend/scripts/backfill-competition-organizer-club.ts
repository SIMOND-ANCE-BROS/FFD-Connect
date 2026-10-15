/**
 * Re-runnable backfill of Competition.organizerClubId (#408).
 *
 * The migration 20261015130000_competition_organizer_club_id already links
 * every competition whose `organizer` label names exactly one club. This
 * script does the same for rows created or left unlinked since (a club
 * created after the migration, a homonym clash resolved by an admin…), and
 * LISTS what it cannot link: no club with that name, or several clubs whose
 * names only differ by case. Those are never guessed; they keep the name
 * fallback until fixed by hand (rename / merge the homonym, then re-run).
 *
 * When it reports nothing left unlinked on every environment, the name
 * fallback can be removed (follow-up of #408).
 *
 * Idempotent: only rows with `organizerClubId` NULL are read and written (the
 * write re-checks it). Dry run by default; `--apply` writes.
 *
 * Inside the backend container:
 *   node dist/scripts/backfill-competition-organizer-club.js
 *   node dist/scripts/backfill-competition-organizer-club.js --apply
 * Locally: pnpm --filter backend exec tsx scripts/backfill-competition-organizer-club.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  backfillCompetitionOrganizerClub,
  UnlinkedCompetition,
} from "./backfill-competition-organizer-club.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Writes only on explicit request: a bare run is a dry run.
const DRY_RUN = !process.argv.includes("--apply");
const TAG = "🏟️  [backfill-competition-organizer-club]";

// Competition ids and club names only: no personal data.
function list(label: string, rows: UnlinkedCompetition[]): void {
  if (rows.length === 0) return;
  console.warn(`${TAG} ${rows.length} ${label}:`);
  for (const row of rows) {
    console.warn(`  - ${row.id} « ${row.organizer} »`);
  }
}

async function main(): Promise<void> {
  const report = await backfillCompetitionOrganizerClub(prisma, DRY_RUN);
  list("unmatched (no club with that name)", report.unmatched);
  list("ambiguous (several clubs, case only)", report.ambiguous);
  console.log(
    `${TAG} ${DRY_RUN ? "[dry-run] " : ""}${report.scanned} unlinked competition(s) scanned, ${report.linked} ${DRY_RUN ? "would be " : ""}linked, ${report.unmatched.length} unmatched, ${report.ambiguous.length} ambiguous.`,
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
