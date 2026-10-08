import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildSignedLicenseQr } from "./license-qr";
import { LicenseQrService } from "./license-qr.service";

const SECRET = "k".repeat(40);
const LICENSE = {
  number: "FFD-123456",
  validUntil: new Date("2026-08-31T23:59:59.000Z"),
};
const NOW = new Date("2026-06-01T10:00:00.000Z");
const LEGACY_QR = JSON.stringify({
  id: "FFD-123456",
  name: "DOE John",
  valid: true,
  type: "FFD",
});

function makeService(env: Record<string, string | undefined>) {
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  return new LicenseQrService(config);
}

describe("LicenseQrService", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("configuration", () => {
    it("defaults to warn when a secret is set", () => {
      expect(makeService({ QR_SIGNING_SECRET: SECRET }).getMode()).toBe("warn");
    });

    it("honours an explicit mode", () => {
      expect(
        makeService({
          QR_SIGNING_SECRET: SECRET,
          QR_SIGNATURE_MODE: "enforce",
        }).getMode(),
      ).toBe("enforce");
      expect(
        makeService({
          QR_SIGNING_SECRET: SECRET,
          QR_SIGNATURE_MODE: "off",
        }).getMode(),
      ).toBe("off");
    });

    it("falls back to warn on an unknown mode", () => {
      expect(
        makeService({
          QR_SIGNING_SECRET: SECRET,
          QR_SIGNATURE_MODE: "strict",
        }).getMode(),
      ).toBe("warn");
    });

    it.each([undefined, "warn", "off"])(
      "is off without a secret (requested mode: %s) and still boots",
      (mode) => {
        const service = makeService({ QR_SIGNATURE_MODE: mode });
        expect(service.getMode()).toBe("off");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("signing disabled"),
        );
      },
    );

    it("refuses to boot in enforce mode without a secret", () => {
      expect(() => makeService({ QR_SIGNATURE_MODE: "enforce" })).toThrow(
        "QR_SIGNATURE_MODE=enforce requires QR_SIGNING_SECRET (at least 32 characters)",
      );
    });

    it("refuses to boot in enforce mode with a secret shorter than 32 characters", () => {
      expect(() =>
        makeService({
          QR_SIGNING_SECRET: "too-short",
          QR_SIGNATURE_MODE: "enforce",
        }),
      ).toThrow("QR_SIGNATURE_MODE=enforce requires QR_SIGNING_SECRET");
    });

    it("trims the secret before using it", () => {
      const service = makeService({ QR_SIGNING_SECRET: `  ${SECRET}\n` });
      expect(service.buildQrCode(LICENSE)).toBe(
        buildSignedLicenseQr(LICENSE, SECRET),
      );
    });

    it("ignores a secret shorter than 32 characters", () => {
      const service = makeService({
        QR_SIGNING_SECRET: "too-short",
        QR_SIGNATURE_MODE: "warn",
      });
      expect(service.getMode()).toBe("off");
      expect(service.buildQrCode(LICENSE)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("shorter than 32"),
      );
    });
  });

  describe("buildQrCode", () => {
    it("returns the signed QR content when a secret is configured", () => {
      const service = makeService({ QR_SIGNING_SECRET: SECRET });
      expect(service.buildQrCode(LICENSE)).toBe(
        buildSignedLicenseQr(LICENSE, SECRET),
      );
    });

    it("still signs in mode off (verification only is disabled)", () => {
      const service = makeService({
        QR_SIGNING_SECRET: SECRET,
        QR_SIGNATURE_MODE: "off",
      });
      expect(service.buildQrCode(LICENSE)).not.toBeNull();
    });

    it("returns null without a secret or without a license", () => {
      expect(makeService({}).buildQrCode(LICENSE)).toBeNull();
      expect(
        makeService({ QR_SIGNING_SECRET: SECRET }).buildQrCode(null),
      ).toBeNull();
      expect(
        makeService({ QR_SIGNING_SECRET: SECRET }).buildQrCode(undefined),
      ).toBeNull();
    });
  });

  describe("verify", () => {
    const signedQr = buildSignedLicenseQr(LICENSE, SECRET);
    const tamperedQr = signedQr.replace("FFD-123456", "FFD-999999");
    const expiredNow = new Date("2026-09-15T00:00:00.000Z");

    describe("mode off / no secret", () => {
      it("accepts anything without checking (no secret)", () => {
        const service = makeService({});
        expect(service.verify(tamperedQr, NOW)).toEqual({
          identifier: "FFD-999999",
          signedLicenseNumber: false,
          accepted: true,
          mode: "off",
          status: "NOT_CHECKED",
          warning: null,
        });
        expect(service.verify(LEGACY_QR, NOW)).toMatchObject({
          identifier: "FFD-123456",
          accepted: true,
          warning: null,
        });
      });

      it("does not check even with a secret when mode is off", () => {
        const service = makeService({
          QR_SIGNING_SECRET: SECRET,
          QR_SIGNATURE_MODE: "off",
        });
        expect(service.verify(tamperedQr, NOW)).toMatchObject({
          status: "NOT_CHECKED",
          accepted: true,
          warning: null,
        });
      });
    });

    describe("mode warn", () => {
      const service = makeService({ QR_SIGNING_SECRET: SECRET });

      it("accepts a genuine QR without warning", () => {
        expect(service.verify(signedQr, NOW)).toEqual({
          identifier: "FFD-123456",
          signedLicenseNumber: true,
          accepted: true,
          mode: "warn",
          status: "VALID",
          warning: null,
        });
      });

      it("uses the current date by default", () => {
        const future = {
          number: "FFD-1",
          validUntil: new Date(Date.now() + 86_400_000 * 30),
        };
        expect(
          service.verify(buildSignedLicenseQr(future, SECRET)).status,
        ).toBe("VALID");
      });

      it("accepts a legacy unsigned QR with a warning", () => {
        expect(service.verify(LEGACY_QR, NOW)).toEqual({
          identifier: "FFD-123456",
          signedLicenseNumber: false,
          accepted: true,
          mode: "warn",
          status: "UNSIGNED",
          warning: "QR non vérifié : ancien QR non signé",
        });
      });

      it("accepts a tampered QR with a warning", () => {
        expect(service.verify(tamperedQr, NOW)).toMatchObject({
          identifier: "FFD-999999",
          signedLicenseNumber: false,
          accepted: true,
          status: "INVALID_SIGNATURE",
          warning: "QR non vérifié : signature invalide",
        });
      });

      it("treats a malformed signed payload as an invalid signature", () => {
        expect(
          service.verify(JSON.stringify({ id: "FFD-1", sig: "x" }), NOW),
        ).toMatchObject({ status: "INVALID_SIGNATURE", accepted: true });
      });

      it("accepts an expired QR with a warning", () => {
        expect(service.verify(signedQr, expiredNow)).toMatchObject({
          accepted: true,
          status: "EXPIRED",
          warning: "QR non vérifié : licence expirée",
        });
      });
    });

    describe("mode enforce", () => {
      const service = makeService({
        QR_SIGNING_SECRET: SECRET,
        QR_SIGNATURE_MODE: "enforce",
      });

      it("accepts a genuine QR", () => {
        expect(service.verify(signedQr, NOW)).toMatchObject({
          accepted: true,
          status: "VALID",
          mode: "enforce",
        });
      });

      it("refuses a tampered license number", () => {
        expect(service.verify(tamperedQr, NOW)).toMatchObject({
          accepted: false,
          status: "INVALID_SIGNATURE",
        });
      });

      it("refuses a legacy unsigned QR and a raw identifier", () => {
        expect(service.verify(LEGACY_QR, NOW)).toMatchObject({
          accepted: false,
          status: "UNSIGNED",
        });
        expect(service.verify("FFD-123456", NOW)).toMatchObject({
          accepted: false,
          status: "UNSIGNED",
        });
      });

      it("refuses an expired QR", () => {
        expect(service.verify(signedQr, expiredNow)).toMatchObject({
          accepted: false,
          status: "EXPIRED",
        });
      });
    });
  });
});
