import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OcrService } from "../utils/ocr.service";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

@Module({
  imports: [PrismaModule],
  controllers: [LicensesController],
  providers: [LicensesService, LicenseRenewalService, OcrService],
  exports: [LicensesService, LicenseRenewalService],
})
export class LicensesModule {}
