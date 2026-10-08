import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/nestjs";
import { PKPass } from "passkit-generator";
import { buildSignedLicenseQr } from "../qr/license-qr";
import { LicenseQrService } from "../qr/license-qr.service";
import { ApplePassJson, ApplePassLicense } from "./apple-wallet-pass";
import {
  APPLE_WALLET_UNAVAILABLE_MESSAGE,
  AppleWalletPassGenerator,
} from "./apple-wallet-pass.generator";
import {
  createTestPassCertificates,
  readPkpassEntries,
  TEST_PASS_TYPE_ID,
  TEST_TEAM_ID,
  testAppleWalletEnv,
} from "./test-certificates.mock";

jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }));

const QR_SECRET = "unit-test-qr-signing-secret-0123456789";

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function qrService(secret: string | undefined = QR_SECRET): LicenseQrService {
  return new LicenseQrService(config({ QR_SIGNING_SECRET: secret }));
}

const license: ApplePassLicense = {
  id: "license-uuid-1",
  number: "FFD-000123",
  category: "Compétiteur",
  validUntil: new Date("2027-08-30T22:00:00.000Z"),
  firstName: "Ada",
  lastName: "Lovelace",
};

describe("AppleWalletPassGenerator", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => jest.clearAllMocks());

  describe("availability", () => {
    it("is available with a full configuration and QR signing on", () => {
      const generator = new AppleWalletPassGenerator(
        config(testAppleWalletEnv()),
        qrService(),
      );
      expect(generator.isAvailable()).toBe(true);
    });

    it("is unavailable when nothing is configured (info log only)", () => {
      const generator = new AppleWalletPassGenerator(config({}), qrService());
      expect(generator.isAvailable()).toBe(false);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        "Apple Wallet pass disabled: not configured",
      );
    });

    it("is unavailable when a variable is missing, and warns by name only", () => {
      const env = testAppleWalletEnv();
      delete env.WALLET_APPLE_PASS_KEY;
      const generator = new AppleWalletPassGenerator(config(env), qrService());
      expect(generator.isAvailable()).toBe(false);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        "Apple Wallet pass disabled: missing WALLET_APPLE_PASS_KEY",
      );
    });

    it("is unavailable when license QR signing is off: no unsigned QR in a pass", () => {
      const generator = new AppleWalletPassGenerator(
        config(testAppleWalletEnv()),
        qrService(""),
      );
      expect(generator.isAvailable()).toBe(false);
      expect(() => generator.generate(license)).toThrow(
        ServiceUnavailableException,
      );
    });

    it("is unavailable when the pass images cannot be read", () => {
      class NoImages extends AppleWalletPassGenerator {
        protected passAssetsDir(): string {
          return join(tmpdir(), "ffd-wallet-missing-assets");
        }
      }
      const generator = new NoImages(config(testAppleWalletEnv()), qrService());
      expect(generator.isAvailable()).toBe(false);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Apple Wallet pass disabled: pass images not found",
      );
    });

    it("refuses to generate when disabled", () => {
      const generator = new AppleWalletPassGenerator(config({}), qrService());
      expect(() => generator.generate(license)).toThrow(
        APPLE_WALLET_UNAVAILABLE_MESSAGE,
      );
    });
  });

  describe("generate", () => {
    let entries: Record<string, Buffer>;
    let passJson: ApplePassJson;

    beforeAll(() => {
      const generator = new AppleWalletPassGenerator(
        config(testAppleWalletEnv()),
        qrService(),
      );
      const pkpass = generator.generate(license);
      entries = readPkpassEntries(pkpass);
      passJson = JSON.parse(
        entries["pass.json"].toString("utf8"),
      ) as ApplePassJson;
    });

    it("ships pass.json, the images, a manifest and a signature", () => {
      expect(Object.keys(entries).sort()).toEqual(
        [
          "icon.png",
          "icon@2x.png",
          "icon@3x.png",
          "logo.png",
          "logo@2x.png",
          "logo@3x.png",
          "manifest.json",
          "pass.json",
          "signature",
        ].sort(),
      );
    });

    it("carries exactly the signed QR of the license as its barcode", () => {
      expect(passJson.barcodes).toEqual([
        expect.objectContaining({
          format: "PKBarcodeFormatQR",
          message: buildSignedLicenseQr(license, QR_SECRET),
        }),
      ]);
    });

    it("expires at the end of the validity day in Paris, with a stable serial", () => {
      // 2027-08-30T22:00Z is 2027-08-31 00:00 in Paris → ends 2027-08-31T22:00Z.
      expect(passJson.expirationDate).toBe("2027-08-31T22:00:00.000Z");
      expect(passJson.serialNumber).toBe("ffd-connect-license-license-uuid-1");
      expect(passJson.passTypeIdentifier).toBe(TEST_PASS_TYPE_ID);
      expect(passJson.teamIdentifier).toBe(TEST_TEAM_ID);
    });

    it("has no update web service (out of the MVP)", () => {
      expect(passJson).not.toHaveProperty("webServiceURL");
      expect(passJson).not.toHaveProperty("authenticationToken");
    });

    it("lists every file in the manifest with its SHA-1", () => {
      const manifest = JSON.parse(
        entries["manifest.json"].toString("utf8"),
      ) as Record<string, string>;
      for (const name of Object.keys(entries)) {
        if (name === "manifest.json" || name === "signature") continue;
        expect(manifest[name]).toBe(
          createHash("sha1").update(entries[name]).digest("hex"),
        );
      }
    });

    it("signs the manifest with the pass certificate (PKCS#7, detached)", () => {
      const dir = mkdtempSync(join(tmpdir(), "ffd-wallet-verify-"));
      try {
        writeFileSync(join(dir, "manifest.json"), entries["manifest.json"]);
        writeFileSync(join(dir, "signature"), entries.signature);
        writeFileSync(
          join(dir, "signer.pem"),
          createTestPassCertificates().signerCert,
        );
        // Throws (non-zero exit) when the signature does not verify.
        execFileSync(
          "openssl",
          [
            "smime",
            "-verify",
            "-binary",
            "-inform",
            "DER",
            "-in",
            join(dir, "signature"),
            "-content",
            join(dir, "manifest.json"),
            "-noverify",
            "-certfile",
            join(dir, "signer.pem"),
            "-out",
            join(dir, "out"),
          ],
          { stdio: "ignore" },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("signing failure", () => {
    it("answers 503 and reports a PEM-free error to Sentry", () => {
      const generator = new AppleWalletPassGenerator(
        config(testAppleWalletEnv()),
        qrService(),
      );
      const spy = jest
        .spyOn(PKPass.prototype, "getAsBuffer")
        .mockImplementation(() => {
          throw new Error(
            "bad key -----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----",
          );
        });
      try {
        expect(() => generator.generate(license)).toThrow(
          ServiceUnavailableException,
        );
      } finally {
        spy.mockRestore();
      }
      const reported = (Sentry.captureException as jest.Mock).mock
        .calls[0][0] as Error;
      expect(reported.message).toBe(
        "Apple Wallet pass signing failed: bad key [PEM redacted]",
      );
      expect(reported.message).not.toContain("SECRET");
    });

    it("handles a non-Error throw", () => {
      const generator = new AppleWalletPassGenerator(
        config(testAppleWalletEnv()),
        qrService(),
      );
      const spy = jest
        .spyOn(PKPass.prototype, "getAsBuffer")
        .mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "Invalid certificate(s) loaded";
        });
      try {
        expect(() => generator.generate(license)).toThrow(
          ServiceUnavailableException,
        );
      } finally {
        spy.mockRestore();
      }
      expect(Sentry.captureException).toHaveBeenCalledWith(
        new Error(
          "Apple Wallet pass signing failed: Invalid certificate(s) loaded",
        ),
      );
    });
  });
});
