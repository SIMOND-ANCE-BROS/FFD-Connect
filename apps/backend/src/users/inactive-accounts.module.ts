import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { InactiveAccountPurgeService } from "./inactive-account-purge.service";
import { InactiveAccountsQueryService } from "./inactive-accounts.query-service";
import { UsersModule } from "./users.module";

/**
 * Inactive-account purge (#991): a leaf module so that UsersModule (account
 * deletion) and AuthModule (e-mails) do not have to import each other.
 */
@Module({
  imports: [PrismaModule, UsersModule, AuthModule],
  providers: [InactiveAccountsQueryService, InactiveAccountPurgeService],
})
export class InactiveAccountsModule {}
