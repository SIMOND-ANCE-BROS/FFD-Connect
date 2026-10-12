import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomBytes } from "crypto";
import { encryptSecret, isEncryptedSecret } from "./secret-cipher";
import { SecretCipherModule } from "./secret-cipher.module";
import {
  SECRETS_ENCRYPTION_KEY,
  SECRETS_ENCRYPTION_KEY_PREVIOUS,
  SecretCipherService,
} from "./secret-cipher.service";

const SECRET = "club-secret";
const CTX = "club:c1:helloAssoClientSecret";

const build = (keys: Record<string, string | undefined> = {}) =>
  new SecretCipherService({
    get: (name: string) => keys[name],
  } as unknown as ConfigService);

describe("SecretCipherService (#389)", () => {
  const key = randomBytes(32);
  const previous = randomBytes(32);
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  describe("without a key (deploy-safe plaintext mode)", () => {
    it("logs a warning once and does not throw", () => {
      const service = build();
      expect(service.isEnabled).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(SECRETS_ENCRYPTION_KEY);
    });

    it("writes plaintext", () => {
      expect(build().encrypt(SECRET, CTX)).toBe(SECRET);
    });

    it("reads legacy plaintext without asking for a re-encryption", () => {
      expect(build().decrypt(SECRET, CTX)).toEqual({
        plaintext: SECRET,
        needsReEncryption: false,
      });
    });

    it("refuses to open an encrypted value", () => {
      expect(() =>
        build().decrypt(encryptSecret(SECRET, key, CTX), CTX),
      ).toThrow(
        `Encrypted secret found but ${SECRETS_ENCRYPTION_KEY} is not set`,
      );
    });

    it("still opens a value with only the previous key set", () => {
      const service = build({
        [SECRETS_ENCRYPTION_KEY_PREVIOUS]: previous.toString("base64"),
      });
      expect(
        service.decrypt(encryptSecret(SECRET, previous, CTX), CTX),
      ).toEqual({
        plaintext: SECRET,
        needsReEncryption: false,
      });
    });
  });

  describe("with a key", () => {
    const service = () =>
      build({
        [SECRETS_ENCRYPTION_KEY]: key.toString("base64"),
        [SECRETS_ENCRYPTION_KEY_PREVIOUS]: previous.toString("base64"),
      });

    it("does not warn", () => {
      expect(service().isEnabled).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("encrypts and decrypts", () => {
      const s = service();
      const stored = s.encrypt(SECRET, CTX);
      expect(isEncryptedSecret(stored)).toBe(true);
      expect(s.decrypt(stored, CTX)).toEqual({
        plaintext: SECRET,
        needsReEncryption: false,
      });
    });

    it("passes legacy plaintext through and flags it for re-encryption", () => {
      expect(service().decrypt(SECRET, CTX)).toEqual({
        plaintext: SECRET,
        needsReEncryption: true,
      });
    });

    it("flags a value encrypted with the previous key for re-encryption", () => {
      expect(
        service().decrypt(encryptSecret(SECRET, previous, CTX), CTX),
      ).toEqual({
        plaintext: SECRET,
        needsReEncryption: true,
      });
    });

    it("rejects a value decrypted under another context", () => {
      const stored = service().encrypt(SECRET, CTX);
      expect(() =>
        service().decrypt(stored, "club:c2:helloAssoClientSecret"),
      ).toThrow("authentication failed");
    });

    it("rejects a value encrypted with an unknown key", () => {
      expect(() =>
        service().decrypt(encryptSecret(SECRET, randomBytes(32), CTX), CTX),
      ).toThrow("authentication failed");
    });
  });

  it("refuses an invalid key at construction", () => {
    expect(() => build({ [SECRETS_ENCRYPTION_KEY]: "too-short" })).toThrow(
      "Encryption key must be base64-encoded",
    );
  });

  it("is provided by SecretCipherModule", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SecretCipherModule],
    })
      .useMocker((token) =>
        token === ConfigService ? { get: () => undefined } : undefined,
      )
      .compile();
    expect(moduleRef.get(SecretCipherService)).toBeInstanceOf(
      SecretCipherService,
    );
  });
});
