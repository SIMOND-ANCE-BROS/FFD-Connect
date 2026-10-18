import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { getErrorMessage, getErrorStack } from "../../utils/error.utils";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";

/**
 * Sends « Résultats disponibles » once imported results have survived the
 * grace period (#713), instead of at import time: an import deleted right
 * away notifies nobody.
 *
 * Same pattern as UsageRetentionService: an in-process @Cron never wakes the
 * scale-to-zero app (no request, no cost), so a pass also runs at boot; while
 * the app sleeps, pending notifications wait for the next wake.
 */
@Injectable()
export class ResultsNotificationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ResultsNotificationScheduler.name);
  private running = false;

  constructor(
    private readonly eventNotificationService: CompetitionEventNotificationService,
  ) {}

  onModuleInit(): void {
    void this.runPass("boot");
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    await this.runPass("cron");
  }

  async runPass(trigger: "boot" | "cron"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const seen = await this.eventNotificationService.notifySettledResults();
      if (seen > 0) {
        this.logger.log(
          `Pending results notifications (${trigger}): ${seen} competition(s) checked`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Pending results notifications pass failed: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
    } finally {
      this.running = false;
    }
  }
}
