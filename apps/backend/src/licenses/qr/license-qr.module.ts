import { Module } from "@nestjs/common";
import { LicenseQrService } from "./license-qr.service";

/**
 * Standalone so users, licenses and competitions can sign/verify license QR
 * codes without importing each other (ConfigModule is global).
 */
@Module({
  providers: [LicenseQrService],
  exports: [LicenseQrService],
})
export class LicenseQrModule {}
