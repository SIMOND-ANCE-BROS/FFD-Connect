import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubAccountsService } from "./admin-club-accounts.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminController } from "./admin.controller";
import { AdminReferenceService } from "./admin-reference.service";

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [
    AdminAuditService,
    AdminClubAccountsService,
    AdminReferenceService,
    AdminUsersQueryService,
    AdminUsersService,
  ],
})
export class AdminModule {}
