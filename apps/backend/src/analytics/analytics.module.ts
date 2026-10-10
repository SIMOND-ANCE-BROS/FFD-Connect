import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminUsageController } from "./admin-usage.controller";
import { AdminUsageQueryService } from "./admin-usage.query-service";
import { AnalyticsController } from "./analytics.controller";
import { UsageIntakeService } from "./usage-intake.service";
import { UsageRetentionService } from "./usage-retention.service";

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, AdminUsageController],
  providers: [
    UsageIntakeService,
    UsageRetentionService,
    AdminUsageQueryService,
  ],
})
export class AnalyticsModule {}
