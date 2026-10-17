/**
 * Service de nettoyage des sessions et tokens expirés.
 * Nettoie automatiquement les refresh tokens, les password reset tokens, les
 * tokens d'appareil (FCM) et le journal des accès support (#731) hors durée de
 * conservation.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
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
        `Session cleanup completed: ${result.expired} expired, ${result.revoked} revoked, ${result.inactive} inactive refresh tokens, ${result.passwordResetTokens} password reset tokens deleted`,
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
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            revoked: true,
            revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        ],
      },
    });
  }

  async manualCleanup(): Promise<{
    expired: number;
    revoked: number;
    inactive: number;
    passwordResetTokens: number;
  }> {
    return this.purgeStaleTokens();
  }

  private async purgeStaleTokens(): Promise<{
    expired: number;
    revoked: number;
    inactive: number;
    passwordResetTokens: number;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const inactiveDate = new Date(
      Date.now() - this.INACTIVE_SESSION_TIMEOUT_DAYS * 24 * 60 * 60 * 1000,
    );

    const [expired, revoked, inactive, passwordResetTokens] = await Promise.all(
      [
        this.prisma.refreshToken.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        }),
        this.prisma.refreshToken.deleteMany({
          where: { revoked: true, revokedAt: { lt: sevenDaysAgo } },
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
      ],
    );

    return {
      expired: expired.count,
      revoked: revoked.count,
      inactive: inactive.count,
      passwordResetTokens: passwordResetTokens.count,
    };
  }
}
