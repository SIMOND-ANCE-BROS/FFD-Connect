import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  addIsoDays,
  parisDateOf,
  parisMidnightOf,
  statsWindow,
  zeroFill,
  type SeriesRow,
} from "../admin/stats/stats-period";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminUsageDto, UsagePeriod } from "./dto/admin-usage.dto";
import {
  USAGE_KEY_EVENTS,
  USAGE_SESSION_GAP_MINUTES,
  type UsageSpace,
} from "./usage.constants";
import { UsageRetentionService } from "./usage-retention.service";

const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utc = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const round1 = (v: number) => Math.round(v * 10) / 10;
const KEY_EVENTS = Prisma.join([...USAGE_KEY_EVENTS]);
const SESSION_GAP = Prisma.raw(
  `interval '${USAGE_SESSION_GAP_MINUTES} minutes'`,
);
const DAYS: Record<"7d" | "30d", number> = { "7d": 7, "30d": 30 };

interface RawWindow {
  start: Date;
  end: Date;
}
/** Inclusive Paris dates on @db.Date aggregate columns. */
interface DayRange {
  from: string;
  to: string;
}
type Count = bigint | number;

/** Back-office usage dashboard (lot 5): aggregates only, never one install. */
@Injectable()
export class AdminUsageQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: UsageRetentionService,
  ) {}

  async get(
    period: UsagePeriod,
    space?: UsageSpace,
    now: Date = new Date(),
  ): Promise<AdminUsageDto> {
    const today = parisDateOf(now);
    const tomorrow = parisMidnightOf(addIsoDays(today, 1));
    const [activeInstallsThisMonth, versions] = await Promise.all([
      this.distinctInstalls({
        start: parisMidnightOf(`${today.slice(0, 7)}-01`),
        end: tomorrow,
      }),
      this.versions({
        start: parisMidnightOf(addIsoDays(today, -6)),
        end: tomorrow,
      }),
    ]);
    const base = {
      generatedAt: now.toISOString(),
      period,
      to: today,
      activeInstallsThisMonth,
      versions,
    };

    if (period === "12m") {
      const months = statsWindow("12m", now).buckets;
      const range: DayRange = { from: months[0], to: today };
      const [
        aggregatedUntil,
        heatmap,
        activeInstallsPerDay,
        platforms,
        screens,
        events,
        competitions,
      ] = await Promise.all([
        this.retention.aggregatedUntil(),
        this.heatmapAgg(range),
        this.activesAgg(range),
        this.platformsAgg(range),
        this.screensAgg(range, space),
        this.eventsAgg(range, months),
        // Aggregates do not keep the competition: last 90 days of raw events.
        this.competitions({
          start: parisMidnightOf(addIsoDays(today, -89)),
          end: tomorrow,
        }),
      ]);
      return {
        ...base,
        from: range.from,
        bucket: "month",
        aggregatedUntil,
        activeInstallsPerDay,
        sessions: null,
        medianSessionMinutes: null,
        platforms,
        heatmap,
        screens,
        events,
        competitions,
      };
    }

    const days = DAYS[period];
    const from = addIsoDays(today, -(days - 1));
    const w: RawWindow = { start: parisMidnightOf(from), end: tomorrow };
    const dayKeys = Array.from({ length: days }, (_, i) => addIsoDays(from, i));
    const [
      heatmap,
      activeInstallsPerDay,
      sessions,
      platforms,
      screens,
      events,
      competitions,
    ] = await Promise.all([
      this.heatmap(w),
      this.activesPerDay(w, days),
      this.sessions(w),
      this.platforms(w),
      this.screens(w, space),
      this.events(w, dayKeys),
      this.competitions(w),
    ]);
    return {
      ...base,
      from,
      bucket: "day",
      aggregatedUntil: null,
      activeInstallsPerDay,
      ...sessions,
      platforms,
      heatmap,
      screens,
      events,
      competitions,
    };
  }

  // --- raw events (7d / 30d) -------------------------------------------------

  private inWindow(w: RawWindow) {
    return Prisma.sql`"occurredAt" >= ${utc(w.start)} AND "occurredAt" < ${utc(w.end)}`;
  }

  private async heatmap(w: RawWindow): Promise<number[][]> {
    const rows = await this.prisma.$queryRaw<
      { dow: number; hour: number; count: Count }[]
    >(Prisma.sql`
      /* usage:heatmap */
      SELECT (extract(isodow FROM "occurredAt" ${PARIS})::int - 1) AS dow,
             extract(hour FROM "occurredAt" ${PARIS})::int AS hour,
             count(*) AS count
      FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1, 2`);
    return toGrid(rows);
  }

  /** Average of daily distinct installs over the period (days without events count as 0). */
  private async activesPerDay(w: RawWindow, days: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { day: string; installs: Count }[]
    >(Prisma.sql`
      /* usage:actives */
      SELECT to_char(("occurredAt" ${PARIS})::date, 'YYYY-MM-DD') AS day,
             count(DISTINCT "installId") AS installs
      FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1`);
    return round1(rows.reduce((s, r) => s + n(r.installs), 0) / days);
  }

  private async distinctInstalls(w: RawWindow): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ installs: Count }[]>(Prisma.sql`
      /* usage:month */
      SELECT count(DISTINCT "installId") AS installs FROM "UsageEvent" WHERE ${this.inWindow(w)}`);
    return n(row?.installs);
  }

  private async sessions(
    w: RawWindow,
  ): Promise<{ sessions: number; medianSessionMinutes: number | null }> {
    const [row] = await this.prisma.$queryRaw<
      { sessions: Count; median: number | null }[]
    >(Prisma.sql`
      /* usage:sessions */
      WITH e AS (
        SELECT "installId", "occurredAt",
               "occurredAt" - lag("occurredAt") OVER (PARTITION BY "installId" ORDER BY "occurredAt") AS gap
        FROM "UsageEvent" WHERE ${this.inWindow(w)}
      ), s AS (
        SELECT "installId", "occurredAt",
               sum(CASE WHEN gap IS NULL OR gap >= ${SESSION_GAP} THEN 1 ELSE 0 END)
                 OVER (PARTITION BY "installId" ORDER BY "occurredAt") AS sid
        FROM e
      ), d AS (
        SELECT extract(epoch FROM max("occurredAt") - min("occurredAt")) AS secs
        FROM s GROUP BY "installId", sid
      )
      SELECT count(*) AS sessions,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float8 AS median
      FROM d`);
    const sessions = n(row?.sessions);
    const median = row?.median ?? null;
    return {
      sessions,
      medianSessionMinutes:
        sessions === 0 || median === null ? null : round1(median / 60),
    };
  }

  private async platforms(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<
      { platform: string; count: Count }[]
    >(Prisma.sql`
      /* usage:platforms */
      SELECT "platform", count(*) AS count FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1`);
    return toPlatforms(rows);
  }

  private async screens(w: RawWindow, space?: UsageSpace) {
    const bySpace = space ? Prisma.sql`AND "space" = ${space}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { screen: string; views: Count; durationSec: Count }[]
    >(Prisma.sql`
      /* usage:screens */
      SELECT "screen", count(*) AS views, coalesce(sum("durationSec"), 0) AS "durationSec"
      FROM "UsageEvent"
      WHERE ${this.inWindow(w)} AND "name" = 'screen_view' AND "screen" IS NOT NULL ${bySpace}
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 30`);
    return toScreens(rows);
  }

  private async events(w: RawWindow, dayKeys: string[]) {
    const rows = await this.prisma.$queryRaw<
      { start: string; key: string; count: Count }[]
    >(Prisma.sql`
      /* usage:events */
      SELECT to_char(("occurredAt" ${PARIS})::date, 'YYYY-MM-DD') AS start, "name" AS key, count(*) AS count
      FROM "UsageEvent" WHERE ${this.inWindow(w)} AND "name" IN (${KEY_EVENTS}) GROUP BY 1, 2`);
    return zeroFill(dayKeys, toSeries(rows), USAGE_KEY_EVENTS);
  }

  private async versions(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<
      { appVersion: string; installs: Count }[]
    >(Prisma.sql`
      /* usage:versions */
      SELECT "appVersion", count(DISTINCT "installId") AS installs
      FROM "UsageEvent" WHERE ${this.inWindow(w)}
      GROUP BY 1 ORDER BY installs DESC, 1 DESC LIMIT 10`);
    return rows.map((r) => ({
      appVersion: r.appVersion,
      installs: n(r.installs),
    }));
  }

  private async competitions(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<
      { competitionId: string; views: Count }[]
    >(Prisma.sql`
      /* usage:competitions */
      SELECT "competitionId", count(*) AS views FROM "UsageEvent"
      WHERE ${this.inWindow(w)} AND "name" = 'competition_view' AND "competitionId" IS NOT NULL
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 10`);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.competitionId);
    const found = await this.prisma.competition.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
      take: ids.length,
    });
    const titleOf = new Map(found.map((c) => [c.id, c.title]));
    return rows.map((r) => ({
      competitionId: r.competitionId,
      title: titleOf.get(r.competitionId) ?? null,
      views: n(r.views),
    }));
  }

  // --- aggregates (12 months) -------------------------------------------------

  private inDays(r: DayRange) {
    return Prisma.sql`"day" >= ${r.from}::date AND "day" <= ${r.to}::date`;
  }

  private async heatmapAgg(r: DayRange): Promise<number[][]> {
    const rows = await this.prisma.$queryRaw<
      { dow: number; hour: number; count: Count }[]
    >(Prisma.sql`
      /* usage:heatmapAgg */
      SELECT (extract(isodow FROM "day")::int - 1) AS dow, "hour", sum("count") AS count
      FROM "UsageDaily" WHERE ${this.inDays(r)} GROUP BY 1, 2`);
    return toGrid(rows);
  }

  private async activesAgg(r: DayRange): Promise<number> {
    const [row] = await this.prisma.$queryRaw<
      { avg: number | null }[]
    >(Prisma.sql`
      /* usage:activesAgg */
      SELECT avg(t)::float8 AS avg FROM (
        SELECT sum("installs") AS t FROM "UsageDailyActive" WHERE ${this.inDays(r)} GROUP BY "day"
      ) d`);
    return round1(Number(row?.avg ?? 0));
  }

  private async platformsAgg(r: DayRange) {
    const rows = await this.prisma.$queryRaw<
      { platform: string; count: Count }[]
    >(Prisma.sql`
      /* usage:platformsAgg */
      SELECT "platform", sum("count") AS count FROM "UsageDaily" WHERE ${this.inDays(r)} GROUP BY 1`);
    return toPlatforms(rows);
  }

  private async screensAgg(r: DayRange, space?: UsageSpace) {
    const bySpace = space ? Prisma.sql`AND "space" = ${space}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { screen: string; views: Count; durationSec: Count }[]
    >(Prisma.sql`
      /* usage:screensAgg */
      SELECT "screen", sum("count") AS views, sum("durationSec") AS "durationSec" FROM "UsageDaily"
      WHERE ${this.inDays(r)} AND "name" = 'screen_view' AND "screen" <> '' ${bySpace}
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 30`);
    return toScreens(rows);
  }

  private async eventsAgg(r: DayRange, months: string[]) {
    const rows = await this.prisma.$queryRaw<
      { start: string; key: string; count: Count }[]
    >(Prisma.sql`
      /* usage:eventsAgg */
      SELECT to_char(date_trunc('month', "day"), 'YYYY-MM-DD') AS start, "name" AS key, sum("count") AS count
      FROM "UsageDaily" WHERE ${this.inDays(r)} AND "name" IN (${KEY_EVENTS}) GROUP BY 1, 2`);
    return zeroFill(months, toSeries(rows), USAGE_KEY_EVENTS);
  }
}

function toGrid(
  rows: { dow: number; hour: number; count: Count }[],
): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) {
    const dow = Number(r.dow);
    const hour = Number(r.hour);
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24)
      grid[dow][hour] += n(r.count);
  }
  return grid;
}

function toPlatforms(rows: { platform: string; count: Count }[]) {
  const out = { ios: 0, android: 0 };
  for (const r of rows) {
    if (r.platform === "ios" || r.platform === "android")
      out[r.platform] = n(r.count);
  }
  return out;
}

function toScreens(
  rows: { screen: string; views: Count; durationSec: Count }[],
) {
  return rows.map((r) => ({
    screen: r.screen,
    views: n(r.views),
    durationSec: n(r.durationSec),
  }));
}

function toSeries(
  rows: { start: string; key: string; count: Count }[],
): SeriesRow[] {
  return rows.map((r) => ({ start: r.start, key: r.key, count: n(r.count) }));
}
