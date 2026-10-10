import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { UsageIntakeService } from "./usage-intake.service";
import { UsageRetentionService } from "./usage-retention.service";

@Module({
  controllers: [AnalyticsController],
  providers: [UsageIntakeService, UsageRetentionService],
})
export class AnalyticsModule {}
