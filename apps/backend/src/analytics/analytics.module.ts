import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { UsageIntakeService } from "./usage-intake.service";

@Module({
  controllers: [AnalyticsController],
  providers: [UsageIntakeService],
})
export class AnalyticsModule {}
