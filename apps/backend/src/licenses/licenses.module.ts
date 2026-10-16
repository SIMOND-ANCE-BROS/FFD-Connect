import { Module } from "@nestjs/common";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { ParentalConsentModule } from "../parental-consent/parental-consent.module";
import { HealthDataAccessModule } from "../health-data-access/health-data-access.module";
import { PrismaModule } from "../prisma/prisma.module";
import { LicenseQrModule } from "./qr/license-qr.module";
import { AppleWalletModule } from "./wallet/apple-wallet.module";
import { OcrService } from "../utils/ocr.service";
import { HealthDataRetentionService } from "./health-data-retention.service";
import { AdminLicenseRenewalsController } from "./admin-license-renewals.controller";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";
import { LicenseRenewalModerationService } from "./license-renewal-moderation.service";
import { LicenseRenewalNotificationService } from "./license-renewal-notification.service";
import { LicenseRenewalService } from "./license-renewal.service";
import { EntryQrController } from "./entry-qr.controller";
import { EntryQrQueryService } from "./entry-qr.query-service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

@Module({
  imports: [
    PrismaModule,
    LicenseQrModule,
    AppleWalletModule,
    AdminAuditModule,
    ParentalConsentModule,
    HealthDataAccessModule,
  ],
  controllers: [
    LicensesController,
    AdminLicenseRenewalsController,
    EntryQrController,
  ],
  providers: [
    LicensesService,
    EntryQrQueryService,
    LicenseRenewalService,
    LicenseRenewalModerationService,
    LicenseRenewalModerationQueryService,
    LicenseRenewalNotificationService,
    OcrService,
    HealthDataRetentionService,
  ],
  exports: [LicensesService, LicenseRenewalService, HealthDataRetentionService],
})
export class LicensesModule {}
