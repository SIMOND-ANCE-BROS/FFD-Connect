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
  warningClaimableWhere,
  warningDueWhere,
} from "./inactive-account.rules";
import {
  InactiveAccountsQueryService,
  InactiveAccountWarningTarget,
} from "./inactive-accounts.query-service";

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
 * last 20 h), and per-account idempotence underneath: a warning is claimed
 * by a 1-hour lease (`inactivityWarningClaimedAt`, conditional `updateMany`,
 * only one replica sends it); the sent date that a deletion requires is
 * written only after Resend accepted the e-mail. A deletion that lost the
 * race fails on the missing user row and rolls back. Shutdown awaits the
 * pass in progress (stopped after the current account).
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
  private stopping = false;
  private currentPass: Promise<unknown> | null = null;

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

  /**
   * Shutdown (scale-to-zero, new revision): no new pass, the running one
   * stops after the account in progress, and is awaited so its last write
   * (sent date, lease release) completes before Prisma disconnects.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    if (this.currentPass) await this.currentPass;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runPass("cron");
  }

  /** Read through a method: shutdown flips it while a loop is awaiting. */
  private isStopping(): boolean {
    return this.stopping;
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
    if (!this.isEnabled() || this.running || this.stopping) return null;
    if (
      this.lastRunAt !== null &&
      Date.now() - this.lastRunAt < PURGE_MIN_INTERVAL_MS
    ) {
      return null;
    }
    this.running = true;
    const pass = this.executePass(trigger);
    this.currentPass = pass;
    try {
      return await pass;
    } finally {
      this.currentPass = null;
      this.running = false;
    }
  }

  private async executePass(
    trigger: "boot" | "cron",
  ): Promise<InactiveAccountPurgeReport | null> {
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
    let consecutiveFailures = 0;
    let afterId: string | undefined;
    let processed = 0;
    while (processed < MAX_WARNINGS_PER_PASS && !this.isStopping()) {
      const take = Math.min(PURGE_PAGE_SIZE, MAX_WARNINGS_PER_PASS - processed);
      const page = await this.query.findWarningDue(now, afterId, take);
      for (const account of page) {
        if (this.isStopping()) break;
        processed += 1;
        afterId = account.id;
        const outcome = await this.warnOne(account, now);
        if (outcome === "sent") {
          warned += 1;
          consecutiveFailures = 0;
        } else if (outcome === "failed") {
          warningFailures += 1;
          consecutiveFailures += 1;
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

  /**
   * One warning, in three steps that never let an UNSENT warning count:
   * 1. claim a lease (`inactivityWarningClaimedAt`, atomic: one replica);
   * 2. send; 3. only once Resend returned a message id, record
   * `inactivityWarningSentAt` (the only column a deletion depends on) and
   * drop the lease. A crash between 1 and 3 leaves a stale lease, retried
   * after WARNING_CLAIM_LEASE_MS, and no sent date: no deletion.
   */
  private async warnOne(
    account: InactiveAccountWarningTarget,
    now: Date,
  ): Promise<"sent" | "failed" | "skipped"> {
    const claimedAt = new Date();
    const claim = await this.prisma.user.updateMany({
      where: {
        AND: [
          { id: account.id },
          warningDueWhere(now, this.prisma.user.fields.lastLoginAt),
          warningClaimableWhere(claimedAt),
        ],
      },
      data: { inactivityWarningClaimedAt: claimedAt },
    });
    if (claim.count === 0) return "skipped"; // claimed by another replica

    let messageId: string;
    try {
      messageId = await this.email.sendInactiveAccountWarning(
        account.email,
        account.firstName,
        scheduledDeletionDate(account, now),
      );
      if (!messageId) throw new Error("no message id");
    } catch (error) {
      this.logger.warn(
        `Inactive-account warning not sent: ${errorKind(error)}`,
      );
      await this.releaseClaim(account.id, claimedAt);
      return "failed";
    }

    try {
      await this.prisma.user.updateMany({
        where: { id: account.id, inactivityWarningClaimedAt: claimedAt },
        data: {
          inactivityWarningSentAt: new Date(),
          inactivityWarningClaimedAt: null,
        },
      });
    } catch (error) {
      // Sent but not recorded: a duplicate warning later, never a deletion
      // without one. Reported, the pass goes on.
      this.reportWriteFailure("record the sent warning", error);
    }
    return "sent";
  }

  /** Best-effort: a lease left behind expires on its own (no sent date). */
  private async releaseClaim(userId: string, claimedAt: Date): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, inactivityWarningClaimedAt: claimedAt },
        data: { inactivityWarningClaimedAt: null },
      });
    } catch (error) {
      this.reportWriteFailure("release the warning claim", error);
    }
  }

  private reportWriteFailure(what: string, error: unknown): void {
    const kind = errorKind(error);
    this.logger.error(`Inactive-account purge: could not ${what}: ${kind}`);
    Sentry.captureMessage("Inactive-account purge write failed", {
      level: "error",
      tags: { rgpd: "inactive-account-purge-failed" },
      extra: { step: what, error: kind },
    });
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
    while (processed < MAX_DELETIONS_PER_PASS && !this.isStopping()) {
      const take = Math.min(
        PURGE_PAGE_SIZE,
        MAX_DELETIONS_PER_PASS - processed,
      );
      const ids = await this.query.findDeletionDueIds(now, afterId, take);
      for (const userId of ids) {
        if (this.isStopping()) break;
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
