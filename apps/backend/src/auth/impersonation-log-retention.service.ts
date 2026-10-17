import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { anonymizeIp, UNKNOWN_IP } from "../common/logger/anonymize-ip";
import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  impersonationLogIpSelect,
} from "../utils/prisma-selects";

/**
 * Retention of the support-access journal (`ImpersonationLog`, #731).
 *
 * - Rows are kept **365 days** (`IMPERSONATION_LOG_RETENTION_DAYS`), then
 *   deleted: the same year as the health-data access journal (#63) and the
 *   technical logs (privacy policy §5). Long enough to answer "who opened my
 *   account, and why" over a full season, short enough not to keep a trail of
 *   support work forever. The rows outlive an account deletion until then, so
 *   that an access cannot be erased by deleting the account.
 * - The actor's IP is kept in full **90 days**
 *   (`IMPERSONATION_LOG_IP_RETENTION_DAYS`, at most the row retention), the
 *   window in which a misused support access (stolen staff session) gets
 *   investigated; it is then reduced to its network (IPv4 /24, IPv6 /48), the
 *   rule of the logs (#529, `anonymizeIp`).
 *
 * Run by the hourly SessionCleanupService pass (in-process cron + boot): it
 * never wakes the scale-to-zero app, and each pass is bounded so a backlog
 * drains over several passes instead of one long transaction.
 */
export const DEFAULT_IMPERSONATION_LOG_RETENTION_DAYS = 365;
export const DEFAULT_IMPERSONATION_LOG_IP_RETENTION_DAYS = 90;
export const IMPERSONATION_LOG_RETENTION_ENV =
  "IMPERSONATION_LOG_RETENTION_DAYS";
export const IMPERSONATION_LOG_IP_RETENTION_ENV =
  "IMPERSONATION_LOG_IP_RETENTION_DAYS";

/** Bounds shared with env.validation.ts. */
export const MIN_IMPERSONATION_LOG_RETENTION_DAYS = 30;
export const MAX_IMPERSONATION_LOG_RETENTION_DAYS = 3650;

/** Rows deleted per batch, and batches per pass. */
export const IMPERSONATION_LOG_PURGE_BATCH = 1000;
/** Rows whose IP is truncated per batch (one UPDATE each). */
export const IMPERSONATION_LOG_IP_BATCH = 200;
export const IMPERSONATION_LOG_MAX_BATCHES_PER_PASS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Integer number of days in [min, max] read from the config, or `fallback`. */
function configuredDays(
  configService: ConfigService,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw: unknown = configService.get(key);
  const days = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof days === "number" &&
    Number.isInteger(days) &&
    days >= min &&
    days <= max
    ? days
    : fallback;
}

export interface ImpersonationLogRetention {
  /** Days a journal row is kept. */
  readonly rowDays: number;
  /** Days the actor's IP is kept in full (never more than `rowDays`). */
  readonly ipDays: number;
}

/** Configured retention; an invalid value falls back to the default. */
export function resolveImpersonationLogRetention(
  configService: ConfigService,
): ImpersonationLogRetention {
  const rowDays = configuredDays(
    configService,
    IMPERSONATION_LOG_RETENTION_ENV,
    MIN_IMPERSONATION_LOG_RETENTION_DAYS,
    MAX_IMPERSONATION_LOG_RETENTION_DAYS,
    DEFAULT_IMPERSONATION_LOG_RETENTION_DAYS,
  );
  const ipDays = configuredDays(
    configService,
    IMPERSONATION_LOG_IP_RETENTION_ENV,
    0,
    MAX_IMPERSONATION_LOG_RETENTION_DAYS,
    DEFAULT_IMPERSONATION_LOG_IP_RETENTION_DAYS,
  );
  return { rowDays, ipDays: Math.min(ipDays, rowDays) };
}

export interface ImpersonationLogPurgeReport {
  /** Journal rows deleted (older than the row retention). */
  readonly deleted: number;
  /** Rows whose actor IP was reduced to its network. */
  readonly ipTruncated: number;
}

/**
 * Rows still holding a full address: a truncated value carries a `/`
 * (`203.0.113.0/24`) and an unparsable one became `unknown`.
 */
const fullIpWhere = (before: Date): Prisma.ImpersonationLogWhereInput => ({
  startedAt: { lt: before },
  ip: { not: null },
  NOT: [{ ip: { contains: "/" } }, { ip: UNKNOWN_IP }],
});

@Injectable()
export class ImpersonationLogRetentionService {
  readonly retention: ImpersonationLogRetention;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.retention = resolveImpersonationLogRetention(configService);
  }

  async purge(now: Date = new Date()): Promise<ImpersonationLogPurgeReport> {
    const deleted = await this.deleteExpired(
      new Date(now.getTime() - this.retention.rowDays * DAY_MS),
    );
    const ipTruncated = await this.truncateIps(
      new Date(now.getTime() - this.retention.ipDays * DAY_MS),
    );
    return { deleted, ipTruncated };
  }

  /** Deletes rows started before `cutoff`, oldest first (`startedAt` index). */
  private async deleteExpired(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < IMPERSONATION_LOG_MAX_BATCHES_PER_PASS; i++) {
      const rows = await this.prisma.impersonationLog.findMany({
        where: { startedAt: { lt: cutoff } },
        orderBy: { startedAt: "asc" },
        select: idOnlySelect,
        take: IMPERSONATION_LOG_PURGE_BATCH,
      });
      if (rows.length === 0) break;
      const { count } = await this.prisma.impersonationLog.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      deleted += count;
      if (rows.length < IMPERSONATION_LOG_PURGE_BATCH) break;
    }
    return deleted;
  }

  /** Reduces the full IP of rows started before `cutoff` to its network. */
  private async truncateIps(cutoff: Date): Promise<number> {
    let truncated = 0;
    for (let i = 0; i < IMPERSONATION_LOG_MAX_BATCHES_PER_PASS; i++) {
      const rows = await this.prisma.impersonationLog.findMany({
        where: fullIpWhere(cutoff),
        orderBy: { startedAt: "asc" },
        select: impersonationLogIpSelect,
        take: IMPERSONATION_LOG_IP_BATCH,
      });
      if (rows.length === 0) break;
      await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.impersonationLog.update({
            where: { id: row.id },
            data: { ip: anonymizeIp(row.ip) ?? null },
            select: idOnlySelect,
          }),
        ),
      );
      truncated += rows.length;
      if (rows.length < IMPERSONATION_LOG_IP_BATCH) break;
    }
    return truncated;
  }
}
