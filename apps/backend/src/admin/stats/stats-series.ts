import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { SeriesRow, StatsWindow } from "./stats-period";

export type SeriesKey =
  | "signups"
  | "licences"
  | "registrations"
  | "corrections"
  | "bugReports"
  | "adminActions";

/**
 * Identifiers are code constants (never input): they go through Prisma.raw.
 * Values (unit, bounds) are bound parameters.
 */
const SERIES: Record<
  SeriesKey,
  { table: string; split: string; where: string }
> = {
  signups: {
    table: '"User"',
    split: '"role"::text',
    where: 'AND "isStoreReview" = false',
  },
  licences: { table: '"License"', split: "NULL::text", where: "" },
  registrations: {
    table: '"Registration"',
    split: '"status"::text',
    where: "",
  },
  corrections: {
    table: '"TrackCorrection"',
    split: '"reason"::text',
    where: "",
  },
  bugReports: { table: '"BugReport"', split: "NULL::text", where: "" },
  adminActions: { table: '"AdminAuditLog"', split: "NULL::text", where: "" },
};

// Columns are `timestamp(3)` holding UTC: AT TIME ZONE 'UTC' makes them
// timestamptz, then AT TIME ZONE 'Europe/Paris' gives the Paris wall clock.
const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utcBound = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export async function timeSeries(
  prisma: PrismaService,
  key: SeriesKey,
  w: StatsWindow,
): Promise<SeriesRow[]> {
  const s = SERIES[key];
  const query = Prisma.sql`
    SELECT to_char(date_trunc(${w.bucket}, "createdAt" ${PARIS}), 'YYYY-MM-DD') AS start,
           ${Prisma.raw(s.split)} AS key,
           count(*) AS count
    FROM ${Prisma.raw(s.table)}
    WHERE "createdAt" >= ${utcBound(w.start)} AND "createdAt" < ${utcBound(w.end)}
    ${Prisma.raw(s.where)}
    GROUP BY 1, 2`;
  const rows =
    await prisma.$queryRaw<
      { start: string; key: string | null; count: bigint | number }[]
    >(query);
  return rows.map((r) => ({
    start: r.start,
    key: r.key,
    count: Number(r.count),
  }));
}

/** Median handling time (hours, 1 decimal) of corrections decided in the window. */
export async function medianReviewHours(
  prisma: PrismaService,
  w: StatsWindow,
): Promise<number | null> {
  const query = Prisma.sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY extract(epoch FROM "reviewedAt" - "createdAt")
           )::float8 AS median
    FROM "TrackCorrection"
    WHERE "status" IN ('APPROVED', 'REJECTED')
      AND "reviewedAt" >= ${utcBound(w.start)} AND "reviewedAt" < ${utcBound(w.end)}`;
  const [row] = await prisma.$queryRaw<{ median: number | null }[]>(query);
  if (row?.median === null || row?.median === undefined) return null;
  return Math.round((Number(row.median) / 3600) * 10) / 10;
}
