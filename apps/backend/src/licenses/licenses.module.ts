import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OcrService } from "../utils/ocr.service";
import { HealthDataRetentionService } from "./health-data-retention.service";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

@Module({
  imports: [PrismaModule],
  controllers: [LicensesController],
  providers: [
    LicensesService,
    LicenseRenewalService,
    OcrService,
    HealthDataRetentionService,
  ],
  exports: [LicensesService, LicenseRenewalService, HealthDataRetentionService],
})
export class LicensesModule {}
