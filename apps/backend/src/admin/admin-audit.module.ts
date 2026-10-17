import { Module } from "@nestjs/common";
import { AdminAuditLogRetentionService } from "./admin-audit-log-retention.service";
import { AdminAuditService } from "./admin-audit.service";

/**
 * The audit trail on its own, so that domain modules outside the back-office
 * (track-corrections, whose decisions also come from the mobile app) can write
 * to it without importing AdminModule and its auth/users dependencies.
 * Also its retention purge (#741), run by AuthModule's hourly cleanup pass.
 * PrismaModule is global.
 */
@Module({
  providers: [AdminAuditService, AdminAuditLogRetentionService],
  exports: [AdminAuditService, AdminAuditLogRetentionService],
})
export class AdminAuditModule {}
