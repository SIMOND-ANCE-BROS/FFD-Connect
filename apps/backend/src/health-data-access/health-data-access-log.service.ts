import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { HealthDataAccessEntry } from "./dto/health-data-access-log.dto";

/**
 * Retention of the access journal (#63): one year, as announced in the
 * privacy policy (§5). Long enough to answer "who saw my certificate" over a
 * full season (certificates are renewed yearly), short enough not to keep a
 * pseudonymous activity trail of administrators forever.
 */
export const HEALTH_DATA_ACCESS_LOG_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

function toCreateData(
  entry: HealthDataAccessEntry,
): Prisma.HealthDataAccessLogCreateManyInput {
  // Explicit copy: whatever else a caller's object holds never reaches the row.
  return {
    subjectUserId: entry.subjectUserId,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    route: entry.route,
  };
}

/**
 * Access journal for health data (GDPR art. 9 and 32, #63): writes.
 *
 * Callers write the trace BEFORE serving the data (or in the same transaction
 * as the deletion): if the trace cannot be written, the access fails. One
 * row per access, never any content — only ids, capacities, route and date.
 */
@Injectable()
export class HealthDataAccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** The rows, as one operation for an array-form `$transaction([...])`. */
  recordOp(
    entries: readonly HealthDataAccessEntry[],
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return this.prisma.healthDataAccessLog.createMany({
      data: entries.map(toCreateData),
    });
  }

  /** Writes the rows now; nothing to do without entries. */
  async record(entries: readonly HealthDataAccessEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.recordOp(entries);
  }

  /**
   * Deletes the rows older than the retention period. Run by the hourly
   * health-data retention pass (in-process cron + boot, no HTTP wake-up);
   * served by the `createdAt` index.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - HEALTH_DATA_ACCESS_LOG_RETENTION_DAYS * DAY_MS,
    );
    const { count } = await this.prisma.healthDataAccessLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
