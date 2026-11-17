import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { EmailService } from "../auth/email.service";
import { HEALTH_DATA_ACCESS_ROUTES } from "../health-data-access/dto/health-data-access-log.dto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AccountDeletionService } from "./account-deletion.service";
import {
  scheduledDeletionDate,
  warningDueWhere,
} from "./inactive-account.rules";
import { InactiveAccountsQueryService } from "./inactive-accounts.query-service";

/**
 * First pass after boot, delayed: never on the cold-start path of the request
 * that woke the replica.
 */
export const PURGE_BOOT_DELAY_MS = 2 * 60_000;
/** A pass at most every 20 h per replica (daily job, hourly check). */
export const PURGE_MIN_INTERVAL_MS = 20 * 3_600_000;
/** Cross-replica / cross-boot debounce marker (best-effort, Redis optional). */
export const PURGE_LAST_RUN_KEY = "inactive-account-purge:last-run";
export const PURGE_PAGE_SIZE = 50;
/** Sequential Resend calls: keep a pass short; the backlog drains daily. */
export const MAX_WARNINGS_PER_PASS = 100;
export const MAX_DELETIONS_PER_PASS = 100;
/** The mail provider looks down: stop warning for this pass. */
export const MAX_CONSECUTIVE_SEND_FAILURES = 3;

export interface InactiveAccountPurgeReport {
  readonly dryRun: boolean;
  readonly warned: number;
  readonly warningFailures: number;
  readonly deleted: number;
  readonly deletionFailures: number;
  /** Logged in or deleted elsewhere between the read and the deletion. */
  readonly deletionSkipped: number;
}

/** Loggable cause without any personal data (no Prisma message: it may quote arguments). */
function errorKind(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Applies the retention announced by the privacy policy (§5, #991): an
 * account is deleted 3 years after its last login, after a warning e-mail
 * 30 days before (rules: inactive-account.rules.ts).
 *
 * Deletion goes through AccountDeletionService, i.e. the SAME transaction as
 * the in-app and back-office deletions (buildAccountDeletionOperations):
 * licence marked released (#897), results pseudonymised, fingerprints kept.
 * Excluded: the store-review account (filter), and any account never warned.
 *
 * ## Trigger and cost (scale-to-zero)
 * In-process only: an hourly `@Cron` that runs a pass at most every 20 h,
 * plus one pass 2 minutes after boot. No external cron, probe or GitHub
 * schedule: it never wakes the app and costs nothing; it only runs while a
 * replica is awake, which is plenty for a 3-year retention.
 *
 * ## Several replicas
 * Best-effort Redis marker (skips a pass another replica / boot ran in the
 * last 20 h), and per-account idempotence underneath: the warning is claimed
 * by a conditional `updateMany` (only one replica sends it), a deletion that
 * lost the race fails on the missing user row and rolls back.
 *
 * ## Flags (docs/exploitation/purge-comptes-inactifs.md)
 * INACTIVE_ACCOUNT_PURGE_ENABLED=false disables it (enabled by default);
 * INACTIVE_ACCOUNT_PURGE_DRY_RUN=true only logs how many accounts a pass
 * would warn / delete.
 */
@Injectable()
export class InactiveAccountPurgeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InactiveAccountPurgeService.name);
  private running = false;
  private lastRunAt: number | null = null;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly query: InactiveAccountsQueryService,
    private readonly deletion: AccountDeletionService,
    private readonly email: EmailService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        "Inactive-account purge disabled (INACTIVE_ACCOUNT_PURGE_ENABLED=false)",
      );
      return;
    }
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.runPass("boot");
    }, PURGE_BOOT_DELAY_MS);
    this.bootTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.bootTimer = null;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runPass("cron");
  }

  isEnabled(): boolean {
    return (
      this.config.get<string>("INACTIVE_ACCOUNT_PURGE_ENABLED") !== "false"
    );
  }

  isDryRun(): boolean {
    return this.config.get<string>("INACTIVE_ACCOUNT_PURGE_DRY_RUN") === "true";
  }

  /**
   * One pass, debounced. Returns null when skipped (disabled, already
   * running, ran recently here or on another replica). Never throws: a
   * failure is logged and reported to Sentry, the next hour retries.
   */
  async runPass(
    trigger: "boot" | "cron",
  ): Promise<InactiveAccountPurgeReport | null> {
    if (!this.isEnabled() || this.running) return null;
    if (
      this.lastRunAt !== null &&
      Date.now() - this.lastRunAt < PURGE_MIN_INTERVAL_MS
    ) {
      return null;
    }
    this.running = true;
    try {
      const now = new Date();
      const report = this.isDryRun()
        ? await this.dryRun(now)
        : await this.realPass(now);
      this.lastRunAt = Date.now();
      if (report) this.logReport(trigger, report);
      return report;
    } catch (error) {
      const kind = errorKind(error);
      this.logger.error(`Inactive-account purge pass failed: ${kind}`);
      Sentry.captureMessage("Inactive-account purge pass failed", {
        level: "error",
        tags: { rgpd: "inactive-account-purge-failed", trigger },
        extra: { error: kind },
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  private async dryRun(now: Date): Promise<InactiveAccountPurgeReport> {
    const due = await this.query.countDue(now);
    return {
      dryRun: true,
      warned: due.warning,
      warningFailures: 0,
      deleted: due.deletion,
      deletionFailures: 0,
      deletionSkipped: 0,
    };
  }

  private async realPass(
    now: Date,
  ): Promise<InactiveAccountPurgeReport | null> {
    // Another replica (or an earlier boot) ran within the debounce window.
    if (await this.redis.exists(PURGE_LAST_RUN_KEY)) return null;
    await this.redis.set(
      PURGE_LAST_RUN_KEY,
      now.toISOString(),
      Math.floor(PURGE_MIN_INTERVAL_MS / 1000),
    );
    const warnings = await this.warnDueAccounts(now);
    const deletions = await this.deleteDueAccounts(now);
    return { dryRun: false, ...warnings, ...deletions };
  }

  /** Warning e-mails, each claimed in the database before it is sent. */
  async warnDueAccounts(
    now: Date,
  ): Promise<{ warned: number; warningFailures: number }> {
    let warned = 0;
    let warningFailures = 0;
    if (!this.email.canSend()) {
      // No warning means no deletion: the policy is not applied at all.
      this.logger.warn(
        "Inactive-account purge: no e-mail transport (RESEND_API_KEY), no account warned — none will be deleted",
      );
      return { warned, warningFailures };
    }
    const lastLoginAt = this.prisma.user.fields.lastLoginAt;
    let consecutiveFailures = 0;
    let afterId: string | undefined;
    let processed = 0;
    while (processed < MAX_WARNINGS_PER_PASS) {
      const take = Math.min(PURGE_PAGE_SIZE, MAX_WARNINGS_PER_PASS - processed);
      const page = await this.query.findWarningDue(now, afterId, take);
      for (const account of page) {
        processed += 1;
        afterId = account.id;
        // Atomic claim: under concurrency, only one replica matches.
        const claim = await this.prisma.user.updateMany({
          where: {
            AND: [{ id: account.id }, warningDueWhere(now, lastLoginAt)],
          },
          data: { inactivityWarningSentAt: now },
        });
        if (claim.count === 0) continue;
        try {
          await this.email.sendInactiveAccountWarning(
            account.email,
            account.firstName,
            scheduledDeletionDate(account, now),
          );
          warned += 1;
          consecutiveFailures = 0;
        } catch (error) {
          warningFailures += 1;
          consecutiveFailures += 1;
          // Not sent: release the claim, retried at the next pass. Guarded
          // on our own value so a concurrent change is never overwritten.
          await this.prisma.user.updateMany({
            where: { id: account.id, inactivityWarningSentAt: now },
            data: { inactivityWarningSentAt: account.inactivityWarningSentAt },
          });
          this.logger.warn(
            `Inactive-account warning not sent: ${errorKind(error)}`,
          );
          if (consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
            this.logger.warn(
              `Inactive-account purge: ${consecutiveFailures} warnings failed in a row, warnings stopped for this pass`,
            );
            return { warned, warningFailures };
          }
        }
      }
      if (page.length < take) break;
    }
    return { warned, warningFailures };
  }

  /** Deletions through the shared account-deletion chain. */
  async deleteDueAccounts(now: Date): Promise<{
    deleted: number;
    deletionFailures: number;
    deletionSkipped: number;
  }> {
    let deleted = 0;
    let deletionFailures = 0;
    let deletionSkipped = 0;
    let afterId: string | undefined;
    let processed = 0;
    while (processed < MAX_DELETIONS_PER_PASS) {
      const take = Math.min(
        PURGE_PAGE_SIZE,
        MAX_DELETIONS_PER_PASS - processed,
      );
      const ids = await this.query.findDeletionDueIds(now, afterId, take);
      for (const userId of ids) {
        processed += 1;
        afterId = userId;
        // Logged in since the page was read: keep the account.
        if (!(await this.query.isDeletionDue(userId, now))) {
          deletionSkipped += 1;
          continue;
        }
        try {
          await this.deletion.deleteAccount(userId, [], {
            actorUserId: null,
            actorRole: "SYSTEM",
            route: HEALTH_DATA_ACCESS_ROUTES.inactiveAccountPurge,
          });
          deleted += 1;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
          ) {
            // Deleted by another replica (or by its owner) meanwhile.
            deletionSkipped += 1;
            continue;
          }
          deletionFailures += 1;
          this.logger.error(
            `Inactive-account deletion failed: ${errorKind(error)}`,
          );
        }
      }
      if (ids.length < take) break;
    }
    if (deletionFailures > 0) {
      Sentry.captureMessage("Inactive-account deletions failed", {
        level: "error",
        tags: { rgpd: "inactive-account-purge-failed" },
        extra: { failures: deletionFailures },
      });
    }
    return { deleted, deletionFailures, deletionSkipped };
  }

  /**
   * Logged on EVERY pass, zero included: "nothing to do" must stay
   * distinguishable from "the purge no longer runs". Counts only.
   */
  private logReport(
    trigger: "boot" | "cron",
    report: InactiveAccountPurgeReport,
  ): void {
    if (report.dryRun) {
      this.logger.log(
        `Inactive-account purge (${trigger}, DRY RUN): ${report.warned} account(s) would be warned, ${report.deleted} would be deleted`,
      );
      return;
    }
    this.logger.log(
      `Inactive-account purge (${trigger}): ${report.warned} warned (${report.warningFailures} failed), ` +
        `${report.deleted} deleted (${report.deletionFailures} failed, ${report.deletionSkipped} skipped)`,
    );
  }
}
