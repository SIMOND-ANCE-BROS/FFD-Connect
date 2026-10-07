import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminController } from "./admin.controller";
import { AdminReferenceService } from "./admin-reference.service";
import { AdminUserAccountsService } from "./admin-user-accounts.service";

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [
    AdminAuditService,
    AdminClubsQueryService,
    AdminReferenceService,
    AdminUserAccountsService,
    AdminUsersQueryService,
    AdminUsersService,
  ],
})
export class AdminModule {}
