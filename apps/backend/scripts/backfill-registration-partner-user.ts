/**
 * One-shot backfill of Registration.partnerUserId (#395).
 *
 * The compete import (sync-licensees-from-compete.ts) used to create each
 * partner's registration with `partnerName` only. Account deletion finds the
 * registrations naming someone through `partnerUserId`, so these rows kept the
 * deleted person's name. This script links them.
 *
 * Matching rule (findMirrorPartnerUserId, src/users/partner-name-scrub.utils.ts;
 * loop in backfill-registration-partner-user.utils.ts):
 * a registration is linked to the holder of the OTHER registration of the same
 * event with the same bib number (a bib numbers a couple), when that holder is
 * the person `partnerName` names and, if that registration has a partnerName
 * too, it names the first holder back. Never on the name alone: zero or
 * several candidates → the row is left as is and counted as unmatched.
 *
 * Limitation: Registration stores no licence number, so a partner who is not
 * a user, who has no registration of their own in the event, or a bib missing
 * / 0 (import parse failure) cannot be linked. Account deletion still scrubs
 * the event+bib mirror at deletion time (partner-name-scrub.ts).
 *
 * Idempotent: only rows with `partnerUserId` NULL are read and written (the
 * write re-checks it). Dry run by default (reports without writing);
 * `--apply` writes.
 *
 * Run once after the deploy (ops step), inside the backend container:
 *   node dist/scripts/backfill-registration-partner-user.js
 *   node dist/scripts/backfill-registration-partner-user.js --apply
 * Locally: pnpm --filter backend exec tsx scripts/backfill-registration-partner-user.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  BACKFILL_MAX_MIRRORS,
  backfillRegistrationPartnerUsers,
} from "./backfill-registration-partner-user.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Writes only on explicit request: a bare run is a dry run.
const DRY_RUN = !process.argv.includes("--apply");
const TAG = "🔗 [backfill-registration-partner-user]";

async function main(): Promise<void> {
  const report = await backfillRegistrationPartnerUsers(prisma, DRY_RUN);
  if (report.cappedPages > 0) {
    console.warn(
      `${TAG} ${report.cappedPages} page(s) hit the ${BACKFILL_MAX_MIRRORS} mirror cap — re-run to link the rest (idempotent)`,
    );
  }
  // Counts only: no names, no ids (the logs leave the database).
  console.log(
    `${TAG} ${DRY_RUN ? "[dry-run] " : ""}${report.scanned} unlinked registration(s) scanned, ${report.linked} ${DRY_RUN ? "would be " : ""}linked, ${report.unmatched} left unmatched (no unambiguous partner registration).`,
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
