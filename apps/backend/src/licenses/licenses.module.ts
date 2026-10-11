import { Module } from "@nestjs/common";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { LicenseQrModule } from "./qr/license-qr.module";
import { AppleWalletModule } from "./wallet/apple-wallet.module";
import { OcrService } from "../utils/ocr.service";
import { HealthDataRetentionService } from "./health-data-retention.service";
import { AdminLicenseRenewalsController } from "./admin-license-renewals.controller";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";
import { LicenseRenewalModerationService } from "./license-renewal-moderation.service";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

@Module({
  imports: [PrismaModule, LicenseQrModule, AppleWalletModule, AdminAuditModule],
  controllers: [LicensesController, AdminLicenseRenewalsController],
  providers: [
    LicensesService,
    LicenseRenewalService,
    LicenseRenewalModerationService,
    LicenseRenewalModerationQueryService,
    OcrService,
    HealthDataRetentionService,
  ],
  exports: [LicensesService, LicenseRenewalService, HealthDataRetentionService],
})
export class LicensesModule {}
