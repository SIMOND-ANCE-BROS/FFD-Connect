import { createHmac } from "crypto";
import {
  buildSignedLicenseQr,
  canonicalLicenseQrContent,
  LEGACY_LICENSE_QR_VERSION,
  LICENSE_QR_VERSION,
  parisEndOfDay,
  parseLicenseQr,
  SignedLicenseQrPayload,
  toLicenseQrExpiry,
  verifySignedLicenseQr,
} from "./license-qr";

const SECRET = "s".repeat(32);
const OTHER_SECRET = "o".repeat(32);
const LICENSE_ID = "0b7c6d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const LICENSE = {
  id: LICENSE_ID,
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

/** A v1 QR as issued before #466 (number-only binding), signed independently. */
function legacyV1Payload(
  number = "FFD-123456",
  exp = "2026-08-31",
  secret = SECRET,
): SignedLicenseQrPayload {
  const sig = createHmac("sha256", secret)
    .update(JSON.stringify(["ffd-license-qr", 1, number, exp]))
    .digest("base64url");
  return { v: 1, id: number, exp, sig };
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
    it("v2 binds the licence id between the number and the expiry", () => {
      expect(
        canonicalLicenseQrContent(2, "FFD-1", "2026-08-31", LICENSE_ID),
      ).toBe(`["ffd-license-qr",2,"FFD-1","${LICENSE_ID}","2026-08-31"]`);
      // Same number and expiry, another licence: another content.
      expect(
        canonicalLicenseQrContent(2, "FFD-1", "2026-08-31", "other-licence"),
      ).not.toBe(
        canonicalLicenseQrContent(2, "FFD-1", "2026-08-31", LICENSE_ID),
      );
    });

    it("v1 ignores any licence id (legacy content unchanged)", () => {
      expect(
        canonicalLicenseQrContent(1, "FFD-1", "2026-08-31", LICENSE_ID),
      ).toBe('["ffd-license-qr",1,"FFD-1","2026-08-31"]');
    });

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
    it("produces compact v2 JSON with version, number, licence id, expiry and signature", () => {
      const payload = signedPayload();
      expect(LICENSE_QR_VERSION).toBe(2);
      expect(payload).toEqual({
        v: 2,
        id: "FFD-123456",
        lid: LICENSE_ID,
        exp: "2026-08-31",
        sig: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      // Independent canonical string: the test does not trust the code.
      const expected = createHmac("sha256", SECRET)
        .update(
          JSON.stringify([
            "ffd-license-qr",
            2,
            "FFD-123456",
            LICENSE_ID,
            "2026-08-31",
          ]),
        )
        .digest("base64url");
      expect(payload.sig).toBe(expected);
    });

    it("signs a renamed licence with the same licence id and the new number", () => {
      const renamed = JSON.parse(
        buildSignedLicenseQr({ ...LICENSE, number: "FFD-654321" }, SECRET),
      ) as SignedLicenseQrPayload;
      expect(renamed.id).toBe("FFD-654321");
      expect(renamed.lid).toBe(LICENSE_ID);
      expect(renamed.sig).not.toBe(signedPayload().sig);
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

    it("reads a legacy v1 signed payload and drops an unsigned lid", () => {
      const v1 = legacyV1Payload();
      expect(parseLicenseQr(JSON.stringify(v1))).toEqual({
        kind: "signed",
        identifier: "FFD-123456",
        payload: v1,
      });
      // A lid added to a v1 QR is not covered by its signature: never read.
      expect(
        parseLicenseQr(JSON.stringify({ ...v1, lid: "someone-else" })),
      ).toEqual({ kind: "signed", identifier: "FFD-123456", payload: v1 });
    });

    it("flags a v2 payload without a usable licence id", () => {
      const { lid: _lid, ...withoutLid } = signedPayload();
      expect(parseLicenseQr(JSON.stringify(withoutLid))).toEqual({
        kind: "malformed-signed",
        identifier: "FFD-123456",
      });
      expect(
        parseLicenseQr(JSON.stringify({ ...signedPayload(), lid: "" })),
      ).toEqual({ kind: "malformed-signed", identifier: "FFD-123456" });
      expect(
        parseLicenseQr(JSON.stringify({ ...signedPayload(), lid: 42 })),
      ).toEqual({ kind: "malformed-signed", identifier: "FFD-123456" });
      expect(
        parseLicenseQr(
          JSON.stringify({ ...signedPayload(), lid: "x".repeat(65) }),
        ),
      ).toEqual({ kind: "malformed-signed", identifier: "FFD-123456" });
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
        id: LICENSE_ID,
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

    it("rejects a QR moved to another licence id", () => {
      const payload = { ...signedPayload(), lid: "another-licence" };
      expect(verifySignedLicenseQr(payload, SECRET, BEFORE_EXPIRY)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("rejects a v2 payload without licence id", () => {
      const { lid: _lid, ...withoutLid } = signedPayload();
      expect(verifySignedLicenseQr(withoutLid, SECRET, BEFORE_EXPIRY)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("rejects an unknown version", () => {
      expect(
        verifySignedLicenseQr(
          { ...signedPayload(), v: 3 },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
    });

    it("rejects a v2 QR downgraded to v1 (version is signed)", () => {
      const { lid: _lid, ...rest } = signedPayload();
      expect(
        verifySignedLicenseQr(
          { ...rest, v: LEGACY_LICENSE_QR_VERSION },
          SECRET,
          BEFORE_EXPIRY,
        ),
      ).toBe("INVALID_SIGNATURE");
    });

    describe("legacy v1 QR (transition, #466)", () => {
      it("still verifies a genuine v1 QR until it expires", () => {
        expect(
          verifySignedLicenseQr(legacyV1Payload(), SECRET, BEFORE_EXPIRY),
        ).toBe("VALID");
        expect(
          verifySignedLicenseQr(
            legacyV1Payload(),
            SECRET,
            new Date("2026-08-31T22:00:00.000Z"),
          ),
        ).toBe("EXPIRED");
      });

      it("rejects a tampered or foreign-key v1 QR", () => {
        expect(
          verifySignedLicenseQr(
            { ...legacyV1Payload(), id: "FFD-999999" },
            SECRET,
            BEFORE_EXPIRY,
          ),
        ).toBe("INVALID_SIGNATURE");
        expect(
          verifySignedLicenseQr(
            legacyV1Payload("FFD-123456", "2026-08-31", OTHER_SECRET),
            SECRET,
            BEFORE_EXPIRY,
          ),
        ).toBe("INVALID_SIGNATURE");
      });
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

describe("parisEndOfDay", () => {
  it("summer time (UTC+2)", () => {
    expect(parisEndOfDay("2026-08-31").toISOString()).toBe(
      "2026-08-31T22:00:00.000Z",
    );
  });

  it("winter time (UTC+1)", () => {
    expect(parisEndOfDay("2026-12-31").toISOString()).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });

  it("the day before the spring DST switch ends at 00:00 CET", () => {
    // 2026-03-29 is the switch day: 2026-03-28 ends at 00:00 CET (UTC+1).
    expect(parisEndOfDay("2026-03-28").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("the autumn DST switch day ends at 00:00 CET", () => {
    // 2026-10-25 03:00 CEST → 02:00 CET; the next midnight is CET.
    expect(parisEndOfDay("2026-10-25").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
});
