import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { configuredDays, DAY_MS } from "../common/retention/configured-days";
import { PrismaService } from "../prisma/prisma.service";
import { idOnlySelect } from "../utils/prisma-selects";

/**
 * Retention of the back-office audit trail (`AdminAuditLog`, #741).
 *
 * Rows are kept **365 days** (`ADMIN_AUDIT_LOG_RETENTION_DAYS`), then deleted:
 * the same year as the support-access journal (#731), the health-data access
 * journal (#63) and the technical logs (privacy policy §5). A row holds the
 * acting admin's id and the before/after values of the fields it changed
 * (names, e-mail, roles…); a year covers a full season of "who changed my
 * account", without keeping a trail of every back-office edit forever.
 *
 * Side effects once a row is gone (documented in
 * docs/exploitation/donnees-personnelles-logs.md): an account created from the
 * back-office more than a year ago no longer counts as such
 * (`isCreatedByAdmin`: no invitation re-send, `createdByAdmin` false), and an
 * old renewal approval whose reviewer account was deleted shows as automatic.
 *
 * Run by the hourly SessionCleanupService pass (in-process cron + boot): it
 * never wakes the scale-to-zero app. Each pass is bounded (oldest first, on
 * the `createdAt` index) so a backlog drains over several passes instead of
 * one long transaction.
 */
export const DEFAULT_ADMIN_AUDIT_LOG_RETENTION_DAYS = 365;
export const ADMIN_AUDIT_LOG_RETENTION_ENV = "ADMIN_AUDIT_LOG_RETENTION_DAYS";

/** Bounds shared with env.validation.ts. */
export const MIN_ADMIN_AUDIT_LOG_RETENTION_DAYS = 30;
export const MAX_ADMIN_AUDIT_LOG_RETENTION_DAYS = 3650;

/** Rows deleted per batch, and batches per pass. */
export const ADMIN_AUDIT_LOG_PURGE_BATCH = 1000;
export const ADMIN_AUDIT_LOG_MAX_BATCHES_PER_PASS = 10;

/** Configured retention in days; an invalid value falls back to the default. */
export function resolveAdminAuditLogRetentionDays(
  configService: ConfigService,
): number {
  return configuredDays(
    configService,
    ADMIN_AUDIT_LOG_RETENTION_ENV,
    MIN_ADMIN_AUDIT_LOG_RETENTION_DAYS,
    MAX_ADMIN_AUDIT_LOG_RETENTION_DAYS,
    DEFAULT_ADMIN_AUDIT_LOG_RETENTION_DAYS,
  );
}

@Injectable()
export class AdminAuditLogRetentionService {
  readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.retentionDays = resolveAdminAuditLogRetentionDays(configService);
  }

  /** Deletes the rows older than the retention; returns how many. */
  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retentionDays * DAY_MS);
    let deleted = 0;
    for (let i = 0; i < ADMIN_AUDIT_LOG_MAX_BATCHES_PER_PASS; i++) {
      const rows = await this.prisma.adminAuditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        select: idOnlySelect,
        take: ADMIN_AUDIT_LOG_PURGE_BATCH,
      });
      if (rows.length === 0) break;
      const { count } = await this.prisma.adminAuditLog.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      deleted += count;
      if (rows.length < ADMIN_AUDIT_LOG_PURGE_BATCH) break;
    }
    return deleted;
  }
}
