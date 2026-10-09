import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { AdminAuditModule } from "./admin-audit.module";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import { AdminClubsService } from "./admin-clubs.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminController } from "./admin.controller";
import { AdminReferenceService } from "./admin-reference.service";
import { AdminUserAccountsService } from "./admin-user-accounts.service";

@Module({
  imports: [AdminAuditModule, AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [
    AdminClubsQueryService,
    AdminClubsService,
    AdminReferenceService,
    AdminUserAccountsService,
    AdminUsersQueryService,
    AdminUsersService,
  ],
})
export class AdminModule {}
