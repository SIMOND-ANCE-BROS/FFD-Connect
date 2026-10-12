import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Application-level encryption at rest for third-party secrets stored in the
 * database (club HelloAsso client secret, #389; future payment connectors,
 * #388).
 *
 * AES-256-GCM, random 12-byte IV per value, 16-byte auth tag. Stored format:
 *
 *   v1:<iv base64>:<tag base64>:<ciphertext base64>
 *
 * The version prefix lets a value written before encryption (legacy
 * plaintext) be told apart from an encrypted one, and leaves room for a
 * future algorithm change. Pure functions: no config, no logging (callers
 * must never log the plaintext nor the stored value).
 */

export const SECRET_CIPHER_VERSION = "v1";
const PREFIX = `${SECRET_CIPHER_VERSION}:`;
const ALGORITHM = "aes-256-gcm";
export const SECRET_CIPHER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Thrown when a stored value cannot be decrypted (tampered, wrong key…). */
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

/**
 * Parses a base64-encoded 32-byte key. Returns null when the value is absent
 * or blank; throws when it is present but not a valid 32-byte base64 key
 * (the error message never contains the value).
 */
export function parseSecretCipherKey(raw: string | undefined): Buffer | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!BASE64.test(trimmed)) {
    throw new Error("Encryption key must be base64-encoded");
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== SECRET_CIPHER_KEY_BYTES) {
    throw new Error(
      `Encryption key must decode to ${SECRET_CIPHER_KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/** True when the stored value carries the current version prefix. */
export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Encrypts a plaintext secret with a 32-byte key. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_CIPHER_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a value produced by {@link encryptSecret} with one specific key.
 * Throws {@link SecretDecryptionError} on a malformed value, a tampered
 * value or a wrong key (GCM authentication failure).
 */
export function decryptSecret(stored: string, key: Buffer): string {
  assertKey(key);
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== SECRET_CIPHER_VERSION) {
    throw new SecretDecryptionError("Malformed encrypted secret");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError("Malformed encrypted secret");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError(
      "Encrypted secret authentication failed (wrong key or tampered value)",
    );
  }
}

/**
 * Tries each key in order. Returns the plaintext and the index of the key
 * that worked (0 = current key, > 0 = a previous key ⇒ re-encrypt).
 */
export function decryptSecretWithKeys(
  stored: string,
  keys: readonly Buffer[],
): { plaintext: string; keyIndex: number } {
  if (keys.length === 0) {
    throw new SecretDecryptionError("No decryption key configured");
  }
  let lastError: unknown;
  for (const [keyIndex, key] of keys.entries()) {
    try {
      return { plaintext: decryptSecret(stored, key), keyIndex };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof SecretDecryptionError
    ? lastError
    : new SecretDecryptionError("Encrypted secret could not be decrypted");
}

function assertKey(key: Buffer): void {
  if (key.length !== SECRET_CIPHER_KEY_BYTES) {
    throw new Error(`Encryption key must be ${SECRET_CIPHER_KEY_BYTES} bytes`);
  }
}
