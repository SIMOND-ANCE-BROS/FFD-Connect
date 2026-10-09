import { Module } from "@nestjs/common";
import { AdminAuditService } from "./admin-audit.service";

/**
 * The audit trail on its own, so that domain modules outside the back-office
 * (track-corrections, whose decisions also come from the mobile app) can write
 * to it without importing AdminModule and its auth/users dependencies.
 * PrismaModule is global.
 */
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
