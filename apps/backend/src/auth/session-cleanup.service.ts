/**
 * Service de nettoyage des sessions et tokens expirés.
 * Nettoie automatiquement les refresh tokens, les password reset tokens, les
 * tokens d'appareil (FCM), le journal des accès support (#731) et le journal
 * d'audit du back-office (#741) hors durée de conservation.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AdminAuditLogRetentionService } from "../admin/admin-audit-log-retention.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { fillNormalizedEmails } from "./email-identity";
import { ImpersonationLogRetentionService } from "./impersonation-log-retention.service";

@Injectable()
export class SessionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(SessionCleanupService.name);
  private readonly INACTIVE_SESSION_TIMEOUT_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly impersonationLogRetention: ImpersonationLogRetentionService,
    private readonly adminAuditLogRetention: AdminAuditLogRetentionService,
  ) {}

  onModuleInit(): void {
    this.cleanupExpiredSessions().catch((error) => {
      this.logger.error("Error during initial cleanup", error);
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredSessions(): Promise<void> {
    this.logger.log("Starting session cleanup...");

    try {
      const result = await this.purgeStaleTokens();
      this.logger.log(
        `Session cleanup completed: ${result.expired} expired, ${result.inactive} inactive refresh tokens, ${result.passwordResetTokens} password reset tokens deleted`,
      );
    } catch (error) {
      this.logger.error("Error during session cleanup", error);
    }

    // Rétention des tokens d'appareil (RGPD art. 5.1.e). Accrochée à ce cron
    // déjà existant plutôt qu'à une nouvelle planification : le backend tourne à
    // minReplicas=0, et un @Cron in-process ne déclenche aucune requête HTTP
    // donc aucun réveil de conteneur — il ne s'exécute que si une réplique est
    // déjà vivante. Dans son propre try/catch : la purge des device tokens ne
    // doit pas masquer le nettoyage des sessions, ni l'inverse.
    try {
      const purged = await this.notificationsService.purgeExpiredDeviceTokens();
      this.logger.log(`Device token retention: ${purged} token(s) deleted`);
    } catch (error) {
      this.logger.error("Error during device token retention purge", error);
    }

    // Support-access journal retention (#731): same hook, same reason (no new
    // schedule, no wake-up); own try/catch so it never masks the above.
    // Logged on every pass: "nothing to purge" must stay distinguishable from
    // "the purge no longer runs".
    try {
      const { deleted, ipTruncated } =
        await this.impersonationLogRetention.purge();
      this.logger.log(
        `Impersonation log retention: ${deleted} row(s) deleted, ${ipTruncated} IP(s) truncated`,
      );
    } catch (error) {
      this.logger.error(
        "Error during impersonation log retention purge",
        error,
      );
    }

    // Back-office audit trail retention (#741): same hook, same reasons
    // (no wake-up, own try/catch, logged on every pass).
    try {
      const deleted = await this.adminAuditLogRetention.purge();
      this.logger.log(`Admin audit log retention: ${deleted} row(s) deleted`);
    } catch (error) {
      this.logger.error("Error during admin audit log retention purge", error);
    }

    // Lookup keys of rows written without one (#526): rows written by an
    // older release during a rollback window converge here. Same hook, same
    // reason (no new schedule); own try/catch so it never masks the above.
    try {
      const { filled, unresolved } = await fillNormalizedEmails(this.prisma);
      if (filled > 0) {
        this.logger.log(`E-mail lookup keys: ${filled} account(s) filled`);
      }
      if (unresolved > 0) {
        // Counts only, never an address (#529).
        this.logger.warn(
          `E-mail lookup keys: ${unresolved} account(s) share an address differing only by case and have no key (docs/exploitation/email-normalise.md)`,
        );
      }
    } catch (error) {
      this.logger.error("Error while filling e-mail lookup keys", error);
    }
  }

  async cleanupUserSessions(userId: string): Promise<void> {
    // Revoked tokens stay until their expiry: see purgeStaleTokens (#885).
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  }

  async manualCleanup(): Promise<{
    expired: number;
    inactive: number;
    passwordResetTokens: number;
  }> {
    return this.purgeStaleTokens();
  }

  private async purgeStaleTokens(): Promise<{
    expired: number;
    inactive: number;
    passwordResetTokens: number;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const inactiveDate = new Date(
      Date.now() - this.INACTIVE_SESSION_TIMEOUT_DAYS * 24 * 60 * 60 * 1000,
    );

    // A revoked refresh token is only deleted once expired, never earlier
    // (#885): reuse detection (#687, ADR-0006) can only recognise a token
    // that is still in the table. Deleting it a few days after the rotation
    // would turn a stolen copy replayed later into a plain 401 that leaves
    // the thief's family alive. An expired token is refused anyway.
    const [expired, inactive, passwordResetTokens] = await Promise.all([
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.prisma.refreshToken.deleteMany({
        where: {
          revoked: false,
          expiresAt: { gt: new Date() },
          createdAt: { lt: inactiveDate },
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true, createdAt: { lt: sevenDaysAgo } },
          ],
        },
      }),
    ]);

    return {
      expired: expired.count,
      inactive: inactive.count,
      passwordResetTokens: passwordResetTokens.count,
    };
  }
}
