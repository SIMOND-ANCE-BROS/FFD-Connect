import { Module } from "@nestjs/common";
import { CompetitionCacheService } from "../competitions/services/competition-cache.service";
import { AccountDeletionService } from "./account-deletion.service";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { HealthDataAccessModule } from "../health-data-access/health-data-access.module";
import { LicenseQrModule } from "../licenses/qr/license-qr.module";
import { AppleWalletModule } from "../licenses/wallet/apple-wallet.module";
import { WdsfModule } from "../wdsf/wdsf.module";

@Module({
  imports: [
    PrismaModule,
    LicenseQrModule,
    AppleWalletModule,
    WdsfModule,
    HealthDataAccessModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService, CompetitionCacheService],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}
