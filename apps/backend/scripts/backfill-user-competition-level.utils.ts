import { PrismaClient } from "@prisma/client";
import {
  normalizeDiscipline,
  toCompetitionLevel,
} from "../src/common/competition-level";
import { userCompetitionLevelBackfillSelect } from "../src/utils/prisma-selects";

/** Candidate users read per page (keyset pagination on id). */
export const BACKFILL_BATCH_SIZE = 200;

/** Per-discipline levels to write for one user (absent key = left as is). */
export interface CompetitionLevelBackfillPlan {
  competitionLevelLatin?: string;
  competitionLevelStandard?: string;
}

export interface CompetitionLevelBackfillReport {
  /** Users with a legacy level and no per-discipline level. */
  scanned: number;
  /** Users written (dry run: that would be written). */
  updated: number;
  latinOnly: number;
  standardOnly: number;
  both: number;
  /** Legacy value that is not one of the 4 levels: left as is. */
  skippedInvalid: number;
  /** Changed between the read and the write (compare-and-set lost). */
  skippedConcurrent: number;
}

/**
 * Per-discipline levels a legacy single `competitionLevel` stands for (#239).
 * Same rule as the 20261009150000 migration: the declared discipline guides
 * the copy — a Latin dancer gets a Latin level only, a Standard dancer a
 * Standard level only, anyone else (Ten Dance or unknown) both. Copying to a
 * discipline the dancer does not practise would make them eligible for it
 * (a per-discipline level counts as practising). Null when the legacy value
 * is not a known level.
 */
export function planCompetitionLevelBackfill(user: {
  category: string | null;
  competitionLevel: string | null;
}): CompetitionLevelBackfillPlan | null {
  const level = toCompetitionLevel(user.competitionLevel);
  if (!level) return null;
  switch (normalizeDiscipline(user.category)) {
    case "Latin":
      return { competitionLevelLatin: level };
    case "Standard":
      return { competitionLevelStandard: level };
    default:
      return { competitionLevelLatin: level, competitionLevelStandard: level };
  }
}

/**
 * Copies the deprecated single `User.competitionLevel` into the per-discipline
 * levels for the users that have NONE (#239, phase 1). Those are exactly the
 * rows the read fallback still serves, so after the run the fallback is dead
 * and the column can be dropped (phase 2). A user with at least one
 * per-discipline level is never touched (a cleared level stays cleared).
 *
 * Idempotent: only rows with both per-discipline levels NULL are read, and
 * the write re-checks it (compare-and-set). The legacy column is left as is
 * (rollback). `dryRun` counts without writing.
 */
export async function backfillUserCompetitionLevels(
  prisma: PrismaClient,
  dryRun: boolean,
  batchSize = BACKFILL_BATCH_SIZE,
): Promise<CompetitionLevelBackfillReport> {
  const report: CompetitionLevelBackfillReport = {
    scanned: 0,
    updated: 0,
    latinOnly: 0,
    standardOnly: 0,
    both: 0,
    skippedInvalid: 0,
    skippedConcurrent: 0,
  };
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.user.findMany({
      where: {
        competitionLevel: { not: null },
        competitionLevelLatin: null,
        competitionLevelStandard: null,
        ...(cursor && { id: { gt: cursor } }),
      },
      select: userCompetitionLevelBackfillSelect,
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    report.scanned += batch.length;

    for (const user of batch) {
      const plan = planCompetitionLevelBackfill(user);
      if (!plan) {
        report.skippedInvalid++;
        continue;
      }
      if (!dryRun) {
        const { count } = await prisma.user.updateMany({
          where: {
            id: user.id,
            competitionLevelLatin: null,
            competitionLevelStandard: null,
          },
          data: plan,
        });
        if (count === 0) {
          report.skippedConcurrent++;
          continue;
        }
      }
      report.updated++;
      if (plan.competitionLevelLatin && plan.competitionLevelStandard) {
        report.both++;
      } else if (plan.competitionLevelLatin) {
        report.latinOnly++;
      } else {
        report.standardOnly++;
      }
    }
  }
  return report;
}
