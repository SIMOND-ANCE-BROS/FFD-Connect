import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPrivateKey, createPublicKey, KeyObject } from "crypto";
import {
  ENTRY_QR_BATCH_HOURS,
  ENTRY_QR_STEP_SECONDS,
  ENTRY_QR_TOLERANCE_STEPS,
  ENTRY_QR_VERSION,
  EntryQrPayload,
  EntryQrStatus,
  EntryQrSubject,
  entryQrKeyId,
  entryQrStep,
  publicKeyFromRaw,
  rawEd25519PublicKey,
  signEntryQrStep,
  verifyEntryQr,
} from "./entry-qr";
import { parisEndOfDay, toLicenseQrExpiry } from "./license-qr";
import { normalizePem } from "../wallet/apple-wallet.config";

export interface EntryQrPublicKey {
  /** Key id, as carried by the QR (`k`). */
  kid: string;
  /** Raw 32-byte Ed25519 public key, base64url. */
  publicKey: string;
  /** True for the key signing new batches; false for a retired one. */
  active: boolean;
}

export interface EntryQrKeySet {
  version: number;
  stepSeconds: number;
  toleranceSteps: number;
  keys: EntryQrPublicKey[];
}

export interface EntryQrBatch {
  version: number;
  keyId: string;
  licenseId: string;
  number: string;
  holderName: string;
  stepSeconds: number;
  toleranceSteps: number;
  /** Time step of `signatures[0]`; `signatures[i]` signs step `firstStep + i`. */
  firstStep: number;
  signatures: string[];
  /** End of the last step covered: refresh the batch before this instant. */
  coversUntil: Date;
}

interface SigningKey {
  privateKey: KeyObject;
  kid: string;
  raw: string;
}

/**
 * Signs and verifies the rotating entry QR (v3, #24 — ADR-0024).
 *
 * Config (via ConfigService):
 * - `ENTRY_QR_SIGNING_KEY`: Ed25519 private key, PKCS#8 PEM (literal `\n`
 *   accepted). Absent or invalid ⇒ the feature is off: no batch is issued
 *   (the app keeps the static v2 QR) and a v3 QR cannot be verified.
 * - `ENTRY_QR_RETIRED_PUBLIC_KEYS`: comma-separated raw public keys
 *   (base64url) of previous signing keys, still accepted and still published
 *   to scanners until the batches they signed have expired (≤ 12 h).
 */
@Injectable()
export class EntryQrService {
  private readonly logger = new Logger(EntryQrService.name);
  private readonly signingKey: SigningKey | null;
  /** Every key a v3 QR may be verified with (active + retired). */
  private readonly verificationKeys = new Map<string, KeyObject>();
  private readonly publishedKeys: EntryQrPublicKey[] = [];

  constructor(configService: ConfigService) {
    this.signingKey = this.loadSigningKey(
      configService.get<string>("ENTRY_QR_SIGNING_KEY"),
      configService.get<string>("NODE_ENV") === "production",
    );

    if (this.signingKey) {
      this.verificationKeys.set(
        this.signingKey.kid,
        createPublicKey(this.signingKey.privateKey),
      );
      this.publishedKeys.push({
        kid: this.signingKey.kid,
        publicKey: this.signingKey.raw,
        active: true,
      });
    }

    const retired = configService.get<string>("ENTRY_QR_RETIRED_PUBLIC_KEYS");
    for (const raw of (retired ?? "").split(",").map((k) => k.trim())) {
      if (!raw) continue;
      const key = publicKeyFromRaw(raw);
      if (!key) {
        this.logger.warn(
          "ENTRY_QR_RETIRED_PUBLIC_KEYS: ignoring a value that is not a raw Ed25519 public key",
        );
        continue;
      }
      const kid = entryQrKeyId(raw);
      if (this.verificationKeys.has(kid)) continue;
      this.verificationKeys.set(kid, key);
      this.publishedKeys.push({ kid, publicKey: raw, active: false });
    }
  }

  private loadSigningKey(
    raw: string | undefined,
    isProduction: boolean,
  ): SigningKey | null {
    if (!raw?.trim()) {
      this.logger.log(
        "Rotating entry QR disabled (no ENTRY_QR_SIGNING_KEY): the app keeps the static license QR",
      );
      return null;
    }
    try {
      const privateKey = createPrivateKey(normalizePem(raw));
      if (privateKey.asymmetricKeyType !== "ed25519") {
        throw new Error(`unexpected key type ${privateKey.asymmetricKeyType}`);
      }
      const rawPublic = rawEd25519PublicKey(createPublicKey(privateKey));
      return { privateKey, kid: entryQrKeyId(rawPublic), raw: rawPublic };
    } catch (error) {
      // Never log the key material, only why it was rejected.
      const reason = `ENTRY_QR_SIGNING_KEY is set but unusable (must be an Ed25519 PKCS#8 PEM private key): ${
        error instanceof Error ? error.message : "invalid key"
      }`;
      // A key that was meant to be there but is broken would silently turn
      // the rotating QR off (and refuse every offline replay): in production,
      // refuse to boot instead, like QR_SIGNATURE_MODE=enforce without secret.
      if (isProduction) throw new Error(reason);
      this.logger.error(`${reason} — ignored`);
      return null;
    }
  }

  /** True when batches can be issued (a valid signing key is configured). */
  canIssue(): boolean {
    return this.signingKey !== null;
  }

  /** True when at least one key can verify a v3 QR. */
  canVerify(): boolean {
    return this.verificationKeys.size > 0;
  }

  /** Public keys for scanners (offline verification). */
  getKeySet(): EntryQrKeySet {
    return {
      version: ENTRY_QR_VERSION,
      stepSeconds: ENTRY_QR_STEP_SECONDS,
      toleranceSteps: ENTRY_QR_TOLERANCE_STEPS,
      keys: [...this.publishedKeys],
    };
  }

  /**
   * Signs one token per step from the current step up to 12 h ahead, never
   * past the end of the licence validity day (Europe/Paris, same rule as the
   * static QR). Null when signing is off or the licence is no longer valid.
   */
  issueBatch(
    subject: EntryQrSubject,
    licenseValidUntil: Date,
    now: Date = new Date(),
  ): EntryQrBatch | null {
    if (!this.signingKey) return null;
    const licenseEnd = parisEndOfDay(toLicenseQrExpiry(licenseValidUntil));
    if (licenseEnd.getTime() <= now.getTime()) return null;

    const firstStep = entryQrStep(now);
    const horizon = Math.min(
      now.getTime() + ENTRY_QR_BATCH_HOURS * 3600 * 1000,
      licenseEnd.getTime(),
    );
    // Last step that STARTS before the horizon.
    const lastStep = entryQrStep(new Date(horizon - 1));
    const signatures: string[] = [];
    for (let step = firstStep; step <= lastStep; step++) {
      signatures.push(
        signEntryQrStep(
          this.signingKey.privateKey,
          this.signingKey.kid,
          subject,
          step,
        ),
      );
    }
    return {
      version: ENTRY_QR_VERSION,
      keyId: this.signingKey.kid,
      licenseId: subject.licenseId,
      number: subject.number,
      holderName: subject.holderName,
      stepSeconds: ENTRY_QR_STEP_SECONDS,
      toleranceSteps: ENTRY_QR_TOLERANCE_STEPS,
      firstStep,
      signatures,
      coversUntil: new Date((lastStep + 1) * ENTRY_QR_STEP_SECONDS * 1000),
    };
  }

  /** Verifies a parsed v3 QR (signature, then freshness at `now`). */
  verify(payload: EntryQrPayload, now: Date = new Date()): EntryQrStatus {
    return verifyEntryQr(payload, this.verificationKeys, now);
  }
}
