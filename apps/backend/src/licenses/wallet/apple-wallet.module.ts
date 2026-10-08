import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LicenseQrModule } from "../qr/license-qr.module";
import { AppleWalletController } from "./apple-wallet.controller";
import { AppleWalletPassGenerator } from "./apple-wallet-pass.generator";
import { AppleWalletPassService } from "./apple-wallet-pass.service";

/**
 * Apple Wallet license pass (#162). Exports the generator so the license
 * payloads (`/licenses/my`, `/users/me`) can expose whether the feature is
 * available, without users and licenses importing each other.
 */
@Module({
  imports: [PrismaModule, LicenseQrModule],
  controllers: [AppleWalletController],
  providers: [AppleWalletPassGenerator, AppleWalletPassService],
  exports: [AppleWalletPassGenerator],
})
export class AppleWalletModule {}
