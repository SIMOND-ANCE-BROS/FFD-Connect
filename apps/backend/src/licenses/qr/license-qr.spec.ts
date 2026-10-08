import { createHmac } from "crypto";
import {
  buildSignedLicenseQr,
  canonicalLicenseQrContent,
  LICENSE_QR_VERSION,
  parseLicenseQr,
  SignedLicenseQrPayload,
  toLicenseQrExpiry,
  verifySignedLicenseQr,
} from "./license-qr";

const SECRET = "s".repeat(32);
const OTHER_SECRET = "o".repeat(32);
const LICENSE = {
  number: "FFD-123456",
  // Midnight in Paris (CEST, UTC+2) on 2026-08-31.
  validUntil: new Date("2026-08-30T22:00:00.000Z"),
};
const BEFORE_EXPIRY = new Date("2026-06-01T10:00:00.000Z");

function signedPayload(): SignedLicenseQrPayload {
  return JSON.parse(
    buildSignedLicenseQr(LICENSE, SECRET),
  ) as SignedLicenseQrPayload;
}

describe("license-qr", () => {
  describe("toLicenseQrExpiry", () => {
    it("uses the calendar day in Europe/Paris, not UTC", () => {
      // 22:00Z on the 30th is already the 31st in Paris (UTC+2 in summer).
      expect(toLicenseQrExpiry(new Date("2026-08-30T22:00:00.000Z"))).toBe(
        "2026-08-31",
      );
      expect(toLicenseQrExpiry(new Date("2026-08-30T21:59:59.000Z"))).toBe(
        "2026-08-30",
      );
      // Winter time (UTC+1).
      expect(toLicenseQrExpiry(new Date("2026-12-31T23:30:00.000Z"))).toBe(
        "2027-01-01",
      );
    });
  });

  describe("canonicalLicenseQrContent", () => {
    it("is versioned, domain-separated and unambiguous", () => {
      expect(canonicalLicenseQrContent(1, "A|B", "2026-08-31")).toBe(
        '["ffd-license-qr",1,"A|B","2026-08-31"]',
      );
      // Moving a separator between fields changes the canonical content.
      expect(canonicalLicenseQrContent(1, "A", "B|2026-08-31")).not.toBe(
        canonicalLicenseQrContent(1, "A|B", "2026-08-31"),
      );
    });
  });

  describe("buildSignedLicenseQr", () => {
    it("produces compact JSON with version, number, expiry and signature", () => {
      const payload = signedPayload();
      expect(payload).toEqual({
        v: LICENSE_QR_VERSION,
        id: "FFD-123456",
        exp: "2026-08-31",
        sig: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      const expected = createHmac("sha256", SECRET)
        .update(canonicalLicenseQrContent(1, "FFD-123456", "2026-08-31"))
        .digest("base64url");
      expect(payload.sig).toBe(expected);
    });

    it("is deterministic (no stored state needed)", () => {
      expect(buildSignedLicenseQr(LICENSE, SECRET)).toBe(
        buildSignedLicenseQr(LICENSE, SECRET),
      );
    });
  });

  describe("parseLicenseQr", () => {
    it("reads a raw identifier", () => {
      expect(parseLicenseQr("user-1")).toEqual({
        kind: "unsigned",
        identifier: "user-1",
      });
    });

    it("reads the legacy unsigned JSON", () => {
      expect(
        parseLicenseQr(
          JSON.stringify({ id: "FFD-1", name: "X", valid: true, type: "FFD" }),
        ),
      ).toEqual({ kind: "unsigned", identifier: "FFD-1" });
    });

    it("falls back to the raw string for JSON without id or non-object JSON", () => {
      expect(parseLicenseQr("{}")).toEqual({
        kind: "unsigned",
        identifier: "{}",
      });
      expect(parseLicenseQr("12345")).toEqual({
        kind: "unsigned",
        identifier: "12345",
      });
      expect(parseLicenseQr("[1]")).toEqual({
        kind: "unsigned",
        identifier: "[1]",
      });
      expect(parseLicenseQr("null")).toEqual({
        kind: "unsigned",
        identifier: "null",
      });
    });

    it("reads a signed payload", () => {
      const qr = buildSignedLicenseQr(LICENSE, SECRET);
      expect(parseLicenseQr(qr)).toEqual({
        kind: "signed",
        identifier: "FFD-123456",
        payload: signedPayload(),
      });
    });

    it("flags a signed payload with missing or mistyped fields", () => {
      expect(parseLicenseQr(JSON.stringify({ id: "FFD-1", sig: "x" }))).toEqual(
        { kind: "malformed-signed", identifier: "FFD-1" },
      );
      expect(
        parseLicenseQr(
          JSON.stringify({ v: 1, exp: "2026-08-31", sig: "x", id: 42 }),
        ),
      ).toEqual({ kind: "malformed-signed", identifier: "" });
      expect(
        parseLicenseQr(
          JSON.stringify({ v: "1", id: "A", exp: "2026-08-31", sig: "x" }),
        ),
      ).toEqual({ kind: "malformed-signed", identifier: "A" });
      expect(
        parseLicenseQr(JSON.stringify({ v: 1, id: "A", exp: 1, sig: "x" })),
      ).toEqual({ kind: "malformed-signed", identifier: "A" });
      expect(
        parseLicenseQr(
          JSON.stringify({ v: 1, id: "A", exp: "2026-08-31", sig: 1 }),
        ),
      ).toEqual({ kind: "malformed-signed", identifier: "A" });
    });
  });

  describe("verifySignedLicenseQr", () => {
    it("accepts a genuine QR before expiry", () => {
      expect(
        verifySignedLicenseQr(signedPayload(), SECRET, BEFORE_EXPIRY),
      ).toBe("VALID");
    });

    it("accepts the QR until the end of the last day in Paris", () => {
      // 23:59:59 on 2026-08-31 in Paris.
      expect(
        verifySignedLicenseQr(
          signedPayload(),
          SECRET,
          new Date("2026-08-31T21:59:59.000Z"),
        ),
      ).toBe("VALID");
    });

    it("uses the current date by default", () => {
      const future = {
        number: "FFD-1",
        validUntil: new Date(Date.now() + 86_400_000 * 30),
      };
      const payload = JSON.parse(
        buildSignedLicenseQr(future, SECRET),
      ) as SignedLicenseQrPayload;
      expect(verifySignedLicenseQr(payload, SECRET)).toBe("VALID");
    });

    it("rejects a tampered license number", () => {
      const payload = { ...signedPayload(), id: "FFD-999999" };
      expect(verifySignedLicenseQr(payload, SECRET, BEFORE_EXPIRY)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("rejects an extended expiry date", () => {
      const payload = { ...signedPayload(), exp: "2030-08-31" };
      expect(verifySignedLicenseQr(payload, SECRET, BEFORE_EXPIRY)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("rejects a signature made with another secret", () => {
      const forged = JSON.parse(
        buildSignedLicenseQr(LICENSE, OTHER_SECRET),
      ) as SignedLicenseQrPayload;
      expect(verifySignedLicenseQr(forged, SECRET, BEFORE_EXPIRY)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("rejects a truncated or garbage signature", () => {
      const payload = signedPayload();
      expect(
        verifySignedLicenseQr(
          { ...payload, sig: payload.sig.slice(0, 10) },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
      expect(
        verifySignedLicenseQr({ ...payload, sig: "" }, SECRET, BEFORE_EXPIRY),
      ).toBe("INVALID_SIGNATURE");
    });

    it("rejects a signature that is not strict 43-char base64url", () => {
      const payload = signedPayload();
      // Standard base64 alphabet / padding: Buffer would decode it leniently.
      const standardBase64 = Buffer.from(payload.sig, "base64url").toString(
        "base64",
      );
      expect(
        verifySignedLicenseQr(
          { ...payload, sig: standardBase64 },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
      expect(
        verifySignedLicenseQr(
          { ...payload, sig: `${payload.sig.slice(0, 42)}+` },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
      expect(
        verifySignedLicenseQr(
          { ...payload, sig: `${payload.sig}A` },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
    });

    it("rejects an unknown version", () => {
      expect(
        verifySignedLicenseQr(
          { ...signedPayload(), v: 2 },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
    });

    it("rejects a malformed expiry", () => {
      expect(
        verifySignedLicenseQr(
          { ...signedPayload(), exp: "31/08/2026" },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
    });

    it("reports a genuine QR as EXPIRED from midnight in Paris", () => {
      // 00:00 on 2026-09-01 in Paris — still 2026-08-31 in UTC.
      expect(
        verifySignedLicenseQr(
          signedPayload(),
          SECRET,
          new Date("2026-08-31T22:00:00.000Z"),
        ),
      ).toBe("EXPIRED");
    });

    it("treats an impossible calendar date as expired, not valid", () => {
      // Correctly signed by the server for a date Date.parse cannot read.
      const exp = "2026-13-45";
      const sig = createHmac("sha256", SECRET)
        .update(canonicalLicenseQrContent(1, "FFD-1", exp))
        .digest("base64url");
      expect(
        verifySignedLicenseQr(
          { v: 1, id: "FFD-1", exp, sig },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("EXPIRED");
    });
  });
});
