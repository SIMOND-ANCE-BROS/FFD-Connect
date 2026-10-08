import { readFileSync } from "fs";
import { join } from "path";
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/nestjs";
import { PKPass } from "passkit-generator";
import { LicenseQrService } from "../qr/license-qr.service";
import {
  AppleWalletCredentials,
  loadAppleWalletConfig,
  redactPem,
} from "./apple-wallet.config";
import { ApplePassLicense, buildApplePassJson } from "./apple-wallet-pass";

/** MIME type Safari needs to offer "Add to Apple Wallet". */
export const PKPASS_MIME_TYPE = "application/vnd.apple.pkpass";

/** Message returned whenever the feature cannot serve a pass. */
export const APPLE_WALLET_UNAVAILABLE_MESSAGE =
  "L'ajout à Apple Wallet est momentanément indisponible";

/**
 * Pass images, derived from the FFD Connect app icon (no federation logo).
 * Shipped with the build (nest-cli `assets`).
 */
const PASS_IMAGE_FILES = [
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "logo.png",
  "logo@2x.png",
  "logo@3x.png",
] as const;

export const PASS_ASSETS_DIR = join(__dirname, "assets");

function loadPassImages(dir: string): Record<string, Buffer> | null {
  try {
    return Object.fromEntries(
      PASS_IMAGE_FILES.map((file) => [file, readFileSync(join(dir, file))]),
    );
  } catch {
    return null;
  }
}

/**
 * Builds and signs Apple Wallet license passes (#162). No network call:
 * signing is local (PKCS#7 with the pass certificate).
 *
 * Disabled — the backend still boots — when any `WALLET_APPLE_*` variable is
 * missing or invalid, or when license QR signing is off: a static pass must
 * never carry an unsigned QR.
 */
@Injectable()
export class AppleWalletPassGenerator {
  private readonly logger = new Logger(AppleWalletPassGenerator.name);
  private readonly credentials: AppleWalletCredentials | null;
  private readonly images: Record<string, Buffer> | null;

  constructor(
    configService: ConfigService,
    private readonly licenseQrService: LicenseQrService,
  ) {
    const config = loadAppleWalletConfig((key) =>
      configService.get<string>(key),
    );
    this.images = loadPassImages(this.passAssetsDir());

    if (!config.enabled) {
      this.credentials = null;
      const message = `Apple Wallet pass disabled: ${config.reason}`;
      if (config.notConfigured) this.logger.log(message);
      else this.logger.warn(message);
      return;
    }
    if (!this.images) {
      this.credentials = null;
      this.logger.error("Apple Wallet pass disabled: pass images not found");
      return;
    }
    this.credentials = config.credentials;
    if (!licenseQrService.canSign()) {
      this.logger.warn(
        "Apple Wallet pass disabled: license QR signing is off (QR_SIGNING_SECRET)",
      );
    }
  }

  /** Directory holding the pass images (overridable in tests). */
  protected passAssetsDir(): string {
    return PASS_ASSETS_DIR;
  }

  /** True when a pass can be produced (the app shows the button). */
  isAvailable(): boolean {
    return this.credentials !== null && this.licenseQrService.canSign();
  }

  /**
   * Signed `.pkpass` for a license. Throws 503 when the feature is disabled
   * or signing fails (the latter is reported to Sentry, PEM-free).
   */
  generate(license: ApplePassLicense): Buffer {
    const qrMessage = this.licenseQrService.buildQrCode(license);
    if (!this.credentials || !this.images || !qrMessage) {
      throw new ServiceUnavailableException(APPLE_WALLET_UNAVAILABLE_MESSAGE);
    }
    const credentials = this.credentials;

    const passJson = buildApplePassJson({
      passTypeIdentifier: credentials.passTypeIdentifier,
      teamIdentifier: credentials.teamIdentifier,
      license,
      qrMessage,
    });

    try {
      const pass = new PKPass(
        {
          ...this.images,
          "pass.json": Buffer.from(JSON.stringify(passJson)),
        },
        {
          wwdr: credentials.wwdr,
          signerCert: credentials.signerCert,
          signerKey: credentials.signerKey,
        },
      );
      return pass.getAsBuffer();
    } catch (error) {
      const detail = redactPem(
        error instanceof Error ? error.message : String(error),
      );
      const safeError = new Error(
        `Apple Wallet pass signing failed: ${detail}`,
      );
      // 503s are not forwarded to Sentry by the global filter: report here,
      // a signing failure is a misconfiguration someone must fix.
      Sentry.captureException(safeError);
      this.logger.error(safeError.message);
      throw new ServiceUnavailableException(APPLE_WALLET_UNAVAILABLE_MESSAGE);
    }
  }
}
