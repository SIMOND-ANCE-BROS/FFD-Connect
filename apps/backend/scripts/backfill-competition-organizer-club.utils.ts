import { PrismaClient } from "@prisma/client";
import { matchClubByName } from "../src/competitions/competition-organizer";
import { competitionOrganizerBackfillSelect } from "../src/utils/prisma-selects";

/** Unlinked competitions read per page (keyset pagination on id). */
export const BACKFILL_BATCH_SIZE = 200;

/** A competition left unlinked, listed for a human decision. */
export interface UnlinkedCompetition {
  id: string;
  organizer: string;
}

export interface OrganizerBackfillReport {
  scanned: number;
  linked: number;
  /** No club carries the organiser name. */
  unmatched: UnlinkedCompetition[];
  /** Several clubs carry it (case only): never guessed. */
  ambiguous: UnlinkedCompetition[];
}

/**
 * Links `Competition.organizerClubId` (#408) for the rows that only carry an
 * `organizer` label: the ONE club whose name equals it, case and surrounding
 * spaces ignored (matchClubByName — same rule as the runtime fallback and the
 * migration's SQL backfill). Unmatched and ambiguous rows are left NULL and
 * listed. Only rows with `organizerClubId` NULL are read and written (the
 * write re-checks it): idempotent. `dryRun` reports without writing.
 */
export async function backfillCompetitionOrganizerClub(
  prisma: PrismaClient,
  dryRun: boolean,
  batchSize = BACKFILL_BATCH_SIZE,
): Promise<OrganizerBackfillReport> {
  const report: OrganizerBackfillReport = {
    scanned: 0,
    linked: 0,
    unmatched: [],
    ambiguous: [],
  };
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.competition.findMany({
      where: {
        organizerClubId: null,
        organizer: { not: null },
        ...(cursor && { id: { gt: cursor } }),
      },
      select: competitionOrganizerBackfillSelect,
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const competition of batch) {
      const organizer = competition.organizer?.trim();
      if (!organizer) continue; // blank label: nothing to link, nothing to list
      report.scanned++;
      const match = await matchClubByName(prisma, organizer);
      if (match.kind !== "match") {
        report[match.kind === "none" ? "unmatched" : "ambiguous"].push({
          id: competition.id,
          organizer,
        });
        continue;
      }
      if (!dryRun) {
        const { count } = await prisma.competition.updateMany({
          where: { id: competition.id, organizerClubId: null },
          data: { organizerClubId: match.clubId },
        });
        if (count === 0) continue;
      }
      report.linked++;
    }
  }
  return report;
}
