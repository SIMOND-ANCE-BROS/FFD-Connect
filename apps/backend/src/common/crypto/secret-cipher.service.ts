import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  decryptSecretWithKeys,
  encryptSecret,
  isEncryptedSecret,
  parseSecretCipherKey,
  SecretDecryptionError,
} from "./secret-cipher";

export const SECRETS_ENCRYPTION_KEY = "SECRETS_ENCRYPTION_KEY";
export const SECRETS_ENCRYPTION_KEY_PREVIOUS =
  "SECRETS_ENCRYPTION_KEY_PREVIOUS";

export interface DecryptedSecret {
  plaintext: string;
  /**
   * True when the stored value should be rewritten with the current key:
   * legacy plaintext while encryption is enabled, or a value encrypted with
   * the previous key (rotation).
   */
  needsReEncryption: boolean;
}

/**
 * Encrypts third-party secrets at rest (#389), see `secret-cipher.ts`.
 *
 * Config (via ConfigService, never in the database nor the repository):
 * - `SECRETS_ENCRYPTION_KEY`: base64 32-byte key. Absent ⇒ encryption
 *   DISABLED: values are written and read as plaintext (a warning is logged
 *   once at boot) so that a deployment without the key keeps working.
 * - `SECRETS_ENCRYPTION_KEY_PREVIOUS`: optional, previous key during a
 *   rotation. Only used to decrypt; values it opens are flagged for
 *   re-encryption with the current key.
 *
 * A present but invalid key is rejected at boot by env.validation (and by the
 * constructor when the service is built outside the validated config).
 */
@Injectable()
export class SecretCipherService {
  private readonly logger = new Logger(SecretCipherService.name);
  private readonly currentKey: Buffer | null;
  private readonly decryptionKeys: Buffer[];

  constructor(configService: ConfigService) {
    this.currentKey = parseSecretCipherKey(
      configService.get<string>(SECRETS_ENCRYPTION_KEY),
    );
    const previousKey = parseSecretCipherKey(
      configService.get<string>(SECRETS_ENCRYPTION_KEY_PREVIOUS),
    );
    this.decryptionKeys = [this.currentKey, previousKey].filter(
      (key): key is Buffer => key !== null,
    );
    if (!this.currentKey) {
      this.logger.warn(
        `${SECRETS_ENCRYPTION_KEY} is not set: third-party secrets are stored in plaintext`,
      );
    }
  }

  /** True when new values are encrypted (current key configured). */
  get isEnabled(): boolean {
    return this.currentKey !== null;
  }

  /**
   * Encrypts with the current key, bound to `context` (see
   * `secret-contexts.ts`), or returns the plaintext when disabled.
   */
  encrypt(plaintext: string, context: string): string {
    return this.currentKey
      ? encryptSecret(plaintext, this.currentKey, context)
      : plaintext;
  }

  /**
   * Opens a stored value. A value without the version prefix is legacy
   * plaintext and is returned as is. Throws {@link SecretDecryptionError}
   * when an encrypted value cannot be opened (no key, wrong key, wrong
   * context, tampered).
   */
  decrypt(stored: string, context: string): DecryptedSecret {
    if (!isEncryptedSecret(stored)) {
      return { plaintext: stored, needsReEncryption: this.isEnabled };
    }
    if (this.decryptionKeys.length === 0) {
      throw new SecretDecryptionError(
        `Encrypted secret found but ${SECRETS_ENCRYPTION_KEY} is not set`,
      );
    }
    const { plaintext, keyIndex } = decryptSecretWithKeys(
      stored,
      this.decryptionKeys,
      context,
    );
    return {
      plaintext,
      needsReEncryption: this.isEnabled && keyIndex > 0,
    };
  }
}
