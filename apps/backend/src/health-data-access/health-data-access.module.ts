import { Module } from "@nestjs/common";
import { HealthDataAccessLogController } from "./health-data-access-log.controller";
import { HealthDataAccessLogQueryService } from "./health-data-access-log.query-service";
import { HealthDataAccessLogService } from "./health-data-access-log.service";

/**
 * Access journal for health data (#63), on its own like AdminAuditModule, so
 * that the licences and users modules can write to it without importing each
 * other. PrismaModule is global.
 */
@Module({
  controllers: [HealthDataAccessLogController],
  providers: [HealthDataAccessLogService, HealthDataAccessLogQueryService],
  exports: [HealthDataAccessLogService],
})
export class HealthDataAccessModule {}
