/**
 * Service de nettoyage des sessions et tokens expirés.
 * Nettoie automatiquement les refresh tokens, les password reset tokens et les
 * tokens d'appareil (FCM) hors durée de conservation.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SessionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(SessionCleanupService.name);
  private readonly INACTIVE_SESSION_TIMEOUT_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
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
