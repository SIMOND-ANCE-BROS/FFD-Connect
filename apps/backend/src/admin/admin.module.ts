import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminController } from "./admin.controller";
import { AdminReferenceService } from "./admin-reference.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminAuditService, AdminReferenceService, AdminUsersQueryService],
})
export class AdminModule {}
