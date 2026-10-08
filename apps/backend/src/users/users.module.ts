import { Module } from "@nestjs/common";
import { AccountDeletionService } from "./account-deletion.service";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { LicenseQrModule } from "../licenses/qr/license-qr.module";
import { AppleWalletModule } from "../licenses/wallet/apple-wallet.module";

@Module({
  imports: [PrismaModule, LicenseQrModule, AppleWalletModule],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}
