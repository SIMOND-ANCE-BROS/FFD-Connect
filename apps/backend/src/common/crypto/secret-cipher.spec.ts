import { randomBytes } from "crypto";
import {
  decryptSecret,
  decryptSecretWithKeys,
  encryptSecret,
  isEncryptedSecret,
  parseSecretCipherKey,
  SecretDecryptionError,
} from "./secret-cipher";

const SECRET = "helloasso-client-secret-é";
const CTX = "club:c1:helloAssoClientSecret";

describe("secret-cipher (#389)", () => {
  const key = randomBytes(32);

  describe("encryptSecret / decryptSecret", () => {
    it("roundtrips a secret", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      expect(decryptSecret(stored, key, CTX)).toBe(SECRET);
    });

    it("uses the versioned v1:<iv>:<tag>:<ciphertext> format", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      const parts = stored.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
      expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
      expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
      expect(stored).not.toContain(SECRET);
      expect(isEncryptedSecret(stored)).toBe(true);
    });

    it("uses a fresh IV for each value", () => {
      const a = encryptSecret(SECRET, key, CTX);
      const b = encryptSecret(SECRET, key, CTX);
      expect(a).not.toBe(b);
      expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
    });

    it("roundtrips an empty secret", () => {
      expect(decryptSecret(encryptSecret("", key, CTX), key, CTX)).toBe("");
    });

    it("rejects a tampered ciphertext", () => {
      const [v, iv, tag, ct] = encryptSecret(SECRET, key, CTX).split(":");
      const bytes = Buffer.from(ct, "base64");
      bytes[0] ^= 0xff;
      const tampered = [v, iv, tag, bytes.toString("base64")].join(":");
      expect(() => decryptSecret(tampered, key, CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it("rejects a tampered auth tag", () => {
      const [v, iv, tag, ct] = encryptSecret(SECRET, key, CTX).split(":");
      const bytes = Buffer.from(tag, "base64");
      bytes[0] ^= 0xff;
      const tampered = [v, iv, bytes.toString("base64"), ct].join(":");
      expect(() => decryptSecret(tampered, key, CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it("binds the value to its context (AAD): another context fails", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      expect(() =>
        decryptSecret(stored, key, "club:c2:helloAssoClientSecret"),
      ).toThrow(SecretDecryptionError);
      expect(() =>
        decryptSecretWithKeys(stored, [key], "club:c2:helloAssoClientSecret"),
      ).toThrow(SecretDecryptionError);
    });

    it("requires a context", () => {
      expect(() => encryptSecret(SECRET, key, "")).toThrow(
        "Encryption context is required",
      );
      expect(() => decryptSecret("v1:a:b:c", key, "")).toThrow(
        "Encryption context is required",
      );
    });

    it("rejects a truncated auth tag", () => {
      const [v, iv, tag, ct] = encryptSecret(SECRET, key, CTX).split(":");
      const short = Buffer.from(tag, "base64").subarray(0, 12);
      const truncated = [v, iv, short.toString("base64"), ct].join(":");
      expect(() => decryptSecret(truncated, key, CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it("rejects a wrong key", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      expect(() => decryptSecret(stored, randomBytes(32), CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it.each([
      ["missing parts", "v1:abc"],
      ["unknown version", "v2:a:b:c"],
      [
        "short IV",
        `v1:${Buffer.alloc(4).toString("base64")}:${Buffer.alloc(16).toString("base64")}:AA==`,
      ],
    ])("rejects a malformed value (%s)", (_label, stored) => {
      expect(() => decryptSecret(stored, key, CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it("rejects a key that is not 32 bytes", () => {
      expect(() => encryptSecret(SECRET, randomBytes(16), CTX)).toThrow(
        "Encryption key must be 32 bytes",
      );
      expect(() => decryptSecret("v1:a:b:c", randomBytes(16), CTX)).toThrow(
        "Encryption key must be 32 bytes",
      );
    });

    it("never echoes the secret in an error message", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      try {
        decryptSecret(stored, randomBytes(32), CTX);
      } catch (error) {
        expect((error as Error).message).not.toContain(SECRET);
        expect((error as Error).message).not.toContain(stored);
      }
      expect.assertions(2);
    });
  });

  describe("isEncryptedSecret", () => {
    it("treats a value without the version prefix as legacy plaintext", () => {
      expect(isEncryptedSecret(SECRET)).toBe(false);
      expect(isEncryptedSecret("")).toBe(false);
    });
  });

  describe("decryptSecretWithKeys", () => {
    const previous = randomBytes(32);

    it("opens with the current key (index 0)", () => {
      const stored = encryptSecret(SECRET, key, CTX);
      expect(decryptSecretWithKeys(stored, [key, previous], CTX)).toEqual({
        plaintext: SECRET,
        keyIndex: 0,
      });
    });

    it("falls back to the previous key (index 1)", () => {
      const stored = encryptSecret(SECRET, previous, CTX);
      expect(decryptSecretWithKeys(stored, [key, previous], CTX)).toEqual({
        plaintext: SECRET,
        keyIndex: 1,
      });
    });

    it("throws when no key opens the value", () => {
      const stored = encryptSecret(SECRET, randomBytes(32), CTX);
      expect(() => decryptSecretWithKeys(stored, [key, previous], CTX)).toThrow(
        SecretDecryptionError,
      );
    });

    it("throws when no key is configured", () => {
      expect(() =>
        decryptSecretWithKeys(encryptSecret(SECRET, key, CTX), [], CTX),
      ).toThrow("No decryption key configured");
    });
  });

  describe("parseSecretCipherKey", () => {
    it("returns null when absent or blank", () => {
      expect(parseSecretCipherKey(undefined)).toBeNull();
      expect(parseSecretCipherKey("")).toBeNull();
      expect(parseSecretCipherKey("   ")).toBeNull();
    });

    it("parses a base64 32-byte key (trimmed)", () => {
      const parsed = parseSecretCipherKey(` ${key.toString("base64")}\n`);
      expect(parsed?.equals(key)).toBe(true);
    });

    it("rejects a non-base64 value", () => {
      expect(() => parseSecretCipherKey("not base64 !")).toThrow(
        "Encryption key must be base64-encoded",
      );
    });

    it("rejects a key of the wrong length without echoing it", () => {
      const short = randomBytes(16).toString("base64");
      expect(() => parseSecretCipherKey(short)).toThrow(
        "Encryption key must decode to 32 bytes (got 16)",
      );
    });
  });
});
