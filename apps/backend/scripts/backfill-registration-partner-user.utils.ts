import { PrismaClient } from "@prisma/client";
import {
  findMirrorPartnerUserId,
  isUsableBib,
} from "../src/users/partner-name-scrub.utils";
import { registrationPartnerBackfillSelect } from "../src/utils/prisma-selects";

/** Candidate registrations read per page (keyset pagination on id). */
export const BACKFILL_BATCH_SIZE = 200;
/** Bound of the same-event, same-bib registrations read per page. */
export const BACKFILL_MAX_MIRRORS = 5000;

export interface BackfillReport {
  scanned: number;
  linked: number;
  unmatched: number;
  /** Pages whose mirror read hit BACKFILL_MAX_MIRRORS (re-run: idempotent). */
  cappedPages: number;
}

/**
 * Links `Registration.partnerUserId` for the rows that only carry a
 * `partnerName` (#395). Matching rule: findMirrorPartnerUserId — same event,
 * same bib, partnerName naming the other holder, reciprocal when possible,
 * never ambiguous. Only rows with `partnerUserId` NULL are read and written
 * (the write re-checks it): idempotent. `dryRun` counts without writing.
 */
export async function backfillRegistrationPartnerUsers(
  prisma: PrismaClient,
  dryRun: boolean,
  batchSize = BACKFILL_BATCH_SIZE,
): Promise<BackfillReport> {
  const report: BackfillReport = {
    scanned: 0,
    linked: 0,
    unmatched: 0,
    cappedPages: 0,
  };
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.registration.findMany({
      where: {
        partnerUserId: null,
        partnerName: { not: null },
        bibNumber: { gt: 0 },
        ...(cursor && { id: { gt: cursor } }),
      },
      select: registrationPartnerBackfillSelect,
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    report.scanned += batch.length;

    const couples = batch.flatMap((r) =>
      isUsableBib(r.bibNumber)
        ? [{ eventId: r.eventId, bibNumber: r.bibNumber }]
        : [],
    );
    const mirrors = await prisma.registration.findMany({
      where: { OR: couples },
      select: registrationPartnerBackfillSelect,
      // Deterministic page when the cap is hit (counted in cappedPages).
      orderBy: { id: "asc" },
      take: BACKFILL_MAX_MIRRORS,
    });
    if (mirrors.length === BACKFILL_MAX_MIRRORS) report.cappedPages++;
    const byEvent = new Map<string, typeof mirrors>();
    for (const m of mirrors) {
      const list = byEvent.get(m.eventId) ?? [];
      list.push(m);
      byEvent.set(m.eventId, list);
    }

    for (const r of batch) {
      const partnerUserId = findMirrorPartnerUserId(
        {
          userId: r.userId,
          bibNumber: r.bibNumber,
          partnerName: r.partnerName,
          firstName: r.user.firstName,
          lastName: r.user.lastName,
        },
        (byEvent.get(r.eventId) ?? []).map((m) => ({
          userId: m.userId,
          bibNumber: m.bibNumber,
          partnerName: m.partnerName,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
        })),
      );
      if (!partnerUserId) {
        report.unmatched++;
        continue;
      }
      if (!dryRun) {
        const { count } = await prisma.registration.updateMany({
          where: { id: r.id, partnerUserId: null },
          data: { partnerUserId },
        });
        if (count === 0) continue;
      }
      report.linked++;
    }
  }
  return report;
}
