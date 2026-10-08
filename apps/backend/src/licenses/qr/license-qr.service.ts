import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildSignedLicenseQr,
  LicenseQrSubject,
  parseLicenseQr,
  verifySignedLicenseQr,
} from "./license-qr";

export const QR_SIGNATURE_MODES = ["off", "warn", "enforce"] as const;
export type QrSignatureMode = (typeof QR_SIGNATURE_MODES)[number];

/** Same floor as JWT_SECRET: shorter secrets are ignored (treated as absent). */
export const QR_SIGNING_SECRET_MIN_LENGTH = 32;

export type LicenseQrVerificationStatus =
  /** Mode `off` (or no secret configured): nothing was verified. */
  | "NOT_CHECKED"
  | "VALID"
  /** Legacy QR without signature. */
  | "UNSIGNED"
  | "INVALID_SIGNATURE"
  | "EXPIRED";

export interface LicenseQrVerification {
  mode: QrSignatureMode;
  status: LicenseQrVerificationStatus;
  /** Staff-facing warning, null when the QR is verified or not checked. */
  warning: string | null;
}

export interface LicenseQrCheck extends LicenseQrVerification {
  /** Identifier to resolve (license number, or user id for legacy QRs). */
  identifier: string;
  /** False ⇒ the check-in must be refused (mode `enforce` only). */
  accepted: boolean;
  /** True ⇒ the identifier is a signed license number, never a user id. */
  signedLicenseNumber: boolean;
}

const WARNINGS: Record<
  Exclude<LicenseQrVerificationStatus, "NOT_CHECKED" | "VALID">,
  string
> = {
  UNSIGNED: "QR non vérifié : ancien QR non signé",
  INVALID_SIGNATURE: "QR non vérifié : signature invalide",
  EXPIRED: "QR non vérifié : licence expirée",
};

/**
 * Signs license QR codes and verifies them at check-in (#168).
 *
 * Config (via ConfigService):
 * - `QR_SIGNING_SECRET`: HMAC key, trimmed. Absent (or < 32 chars) ⇒ no
 *   signature produced and no verification (equivalent to mode `off`), the
 *   backend still boots — except in mode `enforce`, which refuses to boot.
 * - `QR_SIGNATURE_MODE`: `off` | `warn` (default) | `enforce`.
 */
@Injectable()
export class LicenseQrService {
  private readonly logger = new Logger(LicenseQrService.name);
  private readonly secret: string | null;
  private readonly mode: QrSignatureMode;

  constructor(configService: ConfigService) {
    const rawSecret = configService.get<string>("QR_SIGNING_SECRET")?.trim();
    if (rawSecret && rawSecret.length >= QR_SIGNING_SECRET_MIN_LENGTH) {
      this.secret = rawSecret;
    } else {
      this.secret = null;
      if (rawSecret) {
        this.logger.warn(
          `QR_SIGNING_SECRET ignored: shorter than ${QR_SIGNING_SECRET_MIN_LENGTH} characters`,
        );
      }
    }

    // env.validation already rejects unknown values at boot; the fallback only
    // matters when the service is built outside the validated config.
    const rawMode = configService.get<string>("QR_SIGNATURE_MODE");
    const requested: QrSignatureMode = QR_SIGNATURE_MODES.includes(
      rawMode as QrSignatureMode,
    )
      ? (rawMode as QrSignatureMode)
      : "warn";
    if (requested === "enforce" && !this.secret) {
      // Refusing every check-in silently would be worse than not booting.
      throw new Error(
        `QR_SIGNATURE_MODE=enforce requires QR_SIGNING_SECRET (at least ${QR_SIGNING_SECRET_MIN_LENGTH} characters)`,
      );
    }
    this.mode = this.secret ? requested : "off";

    if (!this.secret) {
      this.logger.warn(
        "License QR signing disabled (no QR_SIGNING_SECRET): QR codes are neither signed nor verified",
      );
    }
  }

  /** Effective mode (always `off` without a usable secret). */
  getMode(): QrSignatureMode {
    return this.mode;
  }

  /**
   * True when QR codes can be signed (a usable secret is configured),
   * whatever the check-in verification mode. A Wallet pass is only issued
   * when this is true: a static pass must never carry an unsigned QR.
   */
  canSign(): boolean {
    return this.secret !== null;
  }

  /**
   * Signed QR content for a license, or null when signing is disabled
   * (the client then falls back to its legacy content).
   */
  buildQrCode(license: LicenseQrSubject | null | undefined): string | null {
    if (!this.secret || !license) return null;
    return buildSignedLicenseQr(license, this.secret);
  }

  /** Verifies a scanned QR according to the configured mode. */
  verify(qrData: string, now: Date = new Date()): LicenseQrCheck {
    const parsed = parseLicenseQr(qrData);

    if (this.mode === "off" || !this.secret) {
      return {
        identifier: parsed.identifier,
        signedLicenseNumber: false,
        accepted: true,
        mode: "off",
        status: "NOT_CHECKED",
        warning: null,
      };
    }

    let status: LicenseQrVerificationStatus;
    if (parsed.kind === "signed") {
      status = verifySignedLicenseQr(parsed.payload, this.secret, now);
    } else if (parsed.kind === "malformed-signed") {
      status = "INVALID_SIGNATURE";
    } else {
      status = "UNSIGNED";
    }

    if (status === "VALID") {
      return {
        identifier: parsed.identifier,
        signedLicenseNumber: true,
        accepted: true,
        mode: this.mode,
        status,
        warning: null,
      };
    }

    return {
      identifier: parsed.identifier,
      signedLicenseNumber: false,
      accepted: this.mode !== "enforce",
      mode: this.mode,
      status,
      warning: WARNINGS[status],
    };
  }
}
