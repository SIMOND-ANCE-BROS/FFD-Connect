import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  addIsoDays,
  addIsoMonths,
  parisDateOf,
  parisMidnightOf,
} from "../admin/stats/stats-period";
import { PrismaService } from "../prisma/prisma.service";
import {
  USAGE_AGG_RETENTION_MONTHS,
  USAGE_RAW_RETENTION_DAYS,
} from "./usage.constants";

export const MAX_ROLLUP_DAYS_PER_RUN = 120;
export const PURGE_BATCH = 10_000;
const DAY_MS = 86_400_000;

const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utc = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** `@db.Date` columns: a Date at 00:00 UTC carries the calendar day. */
const asDbDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOfDbDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Lot 5: rolls finished Paris days of UsageEvent into the anonymous
 * aggregates, then purges. Same pattern as SessionCleanupService: an
 * in-process @Cron never wakes the scale-to-zero app, so a pass also runs
 * at boot.
 */
@Injectable()
export class UsageRetentionService implements OnModuleInit {
  private readonly logger = new Logger(UsageRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.runPass("boot");
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runPass("cron");
  }

  async runPass(trigger: "boot" | "cron"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const days = await this.rollup(now);
      const purged = await this.purge(now);
      this.logger.log(
        `Usage retention (${trigger}): ${days.length} day(s) aggregated, ` +
          `${purged.raw} raw / ${purged.daily} daily / ${purged.active} active purged`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Usage retention pass failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  async aggregatedUntil(): Promise<string | null> {
    const state = await this.prisma.usageRollupState.findUnique({
      where: { id: 1 },
    });
    return state ? isoOfDbDate(state.lastDay) : null;
  }

  async rollup(now: Date): Promise<string[]> {
    const yesterday = addIsoDays(parisDateOf(now), -1);
    const state = await this.prisma.usageRollupState.findUnique({
      where: { id: 1 },
    });
    let first: string;
    if (state) {
      first = addIsoDays(isoOfDbDate(state.lastDay), 1);
    } else {
      const oldest = await this.prisma.usageEvent.findFirst({
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true },
      });
      if (!oldest) {
        await this.prisma.usageRollupState.upsert({
          where: { id: 1 },
          create: { id: 1, lastDay: asDbDate(yesterday) },
          update: {},
        });
        return [];
      }
      first = parisDateOf(oldest.occurredAt);
    }
    const days: string[] = [];
    for (
      let d = first;
      d <= yesterday && days.length < MAX_ROLLUP_DAYS_PER_RUN;
      d = addIsoDays(d, 1)
    ) {
      days.push(d);
    }
    for (const day of days) await this.rollupDay(day);
    return days;
  }

  /** Idempotent: deletes then rewrites the day, in one transaction. */
  private async rollupDay(day: string): Promise<void> {
    const start = parisMidnightOf(day);
    const end = parisMidnightOf(addIsoDays(day, 1));
    const dbDay = asDbDate(day);
    await this.prisma.$transaction(async (tx) => {
      await tx.usageDaily.deleteMany({ where: { day: dbDay } });
      await tx.usageDailyActive.deleteMany({ where: { day: dbDay } });
      await tx.$executeRaw`
        INSERT INTO "UsageDaily" ("day", "hour", "name", "screen", "platform", "appVersion", "space", "count", "durationSec")
        SELECT ${day}::date,
               extract(hour FROM "occurredAt" ${PARIS})::int,
               "name", coalesce("screen", ''), "platform", "appVersion", "space",
               count(*)::int, coalesce(sum("durationSec"), 0)::int
        FROM "UsageEvent"
        WHERE "occurredAt" >= ${utc(start)} AND "occurredAt" < ${utc(end)}
        GROUP BY 2, 3, 4, 5, 6, 7`;
      await tx.$executeRaw`
        INSERT INTO "UsageDailyActive" ("day", "platform", "installs")
        SELECT ${day}::date, "platform", count(DISTINCT "installId")::int
        FROM "UsageEvent"
        WHERE "occurredAt" >= ${utc(start)} AND "occurredAt" < ${utc(end)}
        GROUP BY "platform"`;
      await tx.usageRollupState.upsert({
        where: { id: 1 },
        create: { id: 1, lastDay: dbDay },
        update: { lastDay: dbDay },
      });
    });
  }

  async purge(
    now: Date,
  ): Promise<{ raw: number; daily: number; active: number }> {
    const state = await this.prisma.usageRollupState.findUnique({
      where: { id: 1 },
    });
    let raw = 0;
    if (state) {
      const retention = new Date(
        now.getTime() - USAGE_RAW_RETENTION_DAYS * DAY_MS,
      );
      const afterAggregated = parisMidnightOf(
        addIsoDays(isoOfDbDate(state.lastDay), 1),
      );
      const cut = retention < afterAggregated ? retention : afterAggregated;
      raw = await this.prisma.$executeRaw`
        DELETE FROM "UsageEvent" WHERE "id" IN (
          SELECT "id" FROM "UsageEvent"
          WHERE "occurredAt" < (${cut.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          LIMIT ${PURGE_BATCH})`;
    }
    const firstOfMonth = `${parisDateOf(now).slice(0, 7)}-01`;
    const aggCut = asDbDate(
      addIsoMonths(firstOfMonth, -USAGE_AGG_RETENTION_MONTHS),
    );
    const [daily, active] = await Promise.all([
      this.prisma.usageDaily.deleteMany({ where: { day: { lt: aggCut } } }),
      this.prisma.usageDailyActive.deleteMany({
        where: { day: { lt: aggCut } },
      }),
    ]);
    return { raw, daily: daily.count, active: active.count };
  }
}
