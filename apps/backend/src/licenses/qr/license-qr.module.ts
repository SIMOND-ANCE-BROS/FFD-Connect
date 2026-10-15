import { Module } from "@nestjs/common";
import { EntryQrService } from "./entry-qr.service";
import { LicenseQrService } from "./license-qr.service";

/**
 * Signed static QR (v1/v2, HMAC) and rotating entry QR (v3, Ed25519, #24).
 * Standalone so users, licenses and competitions can sign/verify license QR
 * codes without importing each other (ConfigModule is global).
 */
@Module({
  providers: [LicenseQrService, EntryQrService],
  exports: [LicenseQrService, EntryQrService],
})
export class LicenseQrModule {}
