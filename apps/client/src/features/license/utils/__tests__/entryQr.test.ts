import {
  base64UrlToBytes,
  batchRemainingMs,
  canonicalEntryQrContent,
  claimsEntryQr,
  currentEntryQr,
  entryQrStep,
  parseEntryQr,
  verifyEntryQrOffline,
  type EntryQrBatch,
  type EntryQrKeySet,
  type EntryQrPayload,
} from "../entryQr";

/**
 * Golden vector shared with the backend
 * (apps/backend/src/licenses/qr/entry-qr-test-keys.mock.ts): signed there by
 * Node's Ed25519, verified here by @noble/curves. Any drift in the signed
 * content breaks both suites.
 */
const GOLDEN = {
  publicKey: "9-F1bePZBCVLj1_wx1vDM4oUqMIMXMz2xnV_qPPSWMU",
  keyId: "b3N-LHLYjEQ",
  licenseId: "3f0c6d2e-1111-4222-8333-944445555666",
  number: "FFD-123456",
  holderName: "DUPONT Jean",
  step: 59612345,
  canonical:
    '["ffd-entry-qr",3,"b3N-LHLYjEQ","3f0c6d2e-1111-4222-8333-944445555666","FFD-123456","DUPONT Jean",59612345]',
  signature:
    "3h1jMAEGstTWD3uvtfG1NXqD0IR7dctIYDbx0B_lhnR4LbxgWl3h91Aurw1say6UvJav1q1iUT8TkHRukZERCg",
};

const KEY_SET: EntryQrKeySet = {
  version: 3,
  stepSeconds: 30,
  toleranceSteps: 1,
  keys: [{ kid: GOLDEN.keyId, publicKey: GOLDEN.publicKey, active: true }],
};

const PAYLOAD: EntryQrPayload = {
  v: 3,
  k: GOLDEN.keyId,
  id: GOLDEN.number,
  lid: GOLDEN.licenseId,
  nm: GOLDEN.holderName,
  t: GOLDEN.step,
  sig: GOLDEN.signature,
};

/** 10 s into a step. */
const at = (step: number) => new Date((step * 30 + 10) * 1000);

const BATCH: EntryQrBatch = {
  version: 3,
  keyId: GOLDEN.keyId,
  licenseId: GOLDEN.licenseId,
  number: GOLDEN.number,
  holderName: GOLDEN.holderName,
  stepSeconds: 30,
  toleranceSteps: 1,
  firstStep: GOLDEN.step,
  signatures: [GOLDEN.signature, "x".repeat(86)],
  coversUntil: new Date((GOLDEN.step + 2) * 30 * 1000).toISOString(),
};

describe("entryQr (#24)", () => {
  it("builds the same signed content as the backend", () => {
    expect(canonicalEntryQrContent(PAYLOAD)).toBe(GOLDEN.canonical);
  });

  it("verifies the backend's golden signature offline", () => {
    expect(
      verifyEntryQrOffline(JSON.stringify(PAYLOAD), KEY_SET, at(GOLDEN.step)),
    ).toEqual({
      status: "VALID",
      holderName: "DUPONT Jean",
      licenseNumber: "FFD-123456",
      licenseId: GOLDEN.licenseId,
    });
  });

  it("accepts one step of clock drift each way", () => {
    const qr = JSON.stringify(PAYLOAD);
    expect(verifyEntryQrOffline(qr, KEY_SET, at(GOLDEN.step - 1)).status).toBe(
      "VALID",
    );
    expect(verifyEntryQrOffline(qr, KEY_SET, at(GOLDEN.step + 1)).status).toBe(
      "VALID",
    );
  });

  it("flags a screenshot replayed later as stale, with its holder", () => {
    expect(
      verifyEntryQrOffline(
        JSON.stringify(PAYLOAD),
        KEY_SET,
        at(GOLDEN.step + 2),
      ),
    ).toEqual({
      status: "STALE",
      holderName: "DUPONT Jean",
      licenseNumber: "FFD-123456",
    });
  });

  it.each<[string, Partial<EntryQrPayload>]>([
    ["name", { nm: "MARTIN Paul" }],
    ["number", { id: "FFD-999999" }],
    ["licence", { lid: "other" }],
    ["step", { t: GOLDEN.step + 1 }],
  ])("refuses a QR whose %s was changed", (_label, override) => {
    const tampered = JSON.stringify({ ...PAYLOAD, ...override });
    expect(
      verifyEntryQrOffline(tampered, KEY_SET, at(GOLDEN.step)).status,
    ).toBe("INVALID_SIGNATURE");
  });

  it("refuses an unknown key or an unusable published key", () => {
    const qr = JSON.stringify(PAYLOAD);
    expect(
      verifyEntryQrOffline(qr, { ...KEY_SET, keys: [] }, at(GOLDEN.step))
        .status,
    ).toBe("INVALID_SIGNATURE");
    expect(
      verifyEntryQrOffline(
        qr,
        {
          ...KEY_SET,
          keys: [{ kid: GOLDEN.keyId, publicKey: "short", active: true }],
        },
        at(GOLDEN.step),
      ).status,
    ).toBe("INVALID_SIGNATURE");
  });

  it("refuses a signature that is not a valid curve point", () => {
    const qr = JSON.stringify({ ...PAYLOAD, sig: "_".repeat(86) });
    expect(verifyEntryQrOffline(qr, KEY_SET, at(GOLDEN.step)).status).toBe(
      "INVALID_SIGNATURE",
    );
  });

  it("calls a malformed v3 QR invalid, anything else not a rotating QR", () => {
    expect(
      verifyEntryQrOffline(
        JSON.stringify({ v: 3, id: "FFD-1" }),
        KEY_SET,
        at(GOLDEN.step),
      ).status,
    ).toBe("INVALID_SIGNATURE");
    for (const other of [
      '{"v":2,"id":"FFD-1","lid":"l","exp":"2026-08-31","sig":"s"}',
      "FFD-123456",
      "[3]",
    ]) {
      expect(verifyEntryQrOffline(other, KEY_SET, at(GOLDEN.step)).status).toBe(
        "NOT_ENTRY_QR",
      );
    }
  });

  describe("parseEntryQr", () => {
    it.each<[string, Record<string, unknown>]>([
      ["key id", { k: "bad" }],
      ["number", { id: "" }],
      ["long licence id", { lid: "x".repeat(65) }],
      ["name", { nm: 3 }],
      ["long name", { nm: "x".repeat(65) }],
      ["step", { t: -1 }],
      ["fractional step", { t: 1.5 }],
      ["signature", { sig: "abc" }],
    ])("rejects a bad %s", (_label, override) => {
      expect(parseEntryQr(JSON.stringify({ ...PAYLOAD, ...override }))).toBe(
        null,
      );
    });

    it("rejects non-JSON and other versions", () => {
      expect(parseEntryQr("nope")).toBeNull();
      expect(parseEntryQr(JSON.stringify({ ...PAYLOAD, v: 2 }))).toBeNull();
    });
  });

  describe("currentEntryQr", () => {
    it("shows the token of the current step with its countdown", () => {
      const current = currentEntryQr(BATCH, at(GOLDEN.step));
      expect(current?.secondsLeft).toBe(20);
      expect(JSON.parse(current?.qrData ?? "{}")).toEqual(PAYLOAD);
    });

    it("moves to the next token at the next step", () => {
      const next = currentEntryQr(BATCH, at(GOLDEN.step + 1));
      expect(JSON.parse(next?.qrData ?? "{}")).toMatchObject({
        t: GOLDEN.step + 1,
        sig: "x".repeat(86),
      });
    });

    it("has nothing before or after the batch", () => {
      expect(currentEntryQr(BATCH, at(GOLDEN.step - 1))).toBeNull();
      expect(currentEntryQr(BATCH, at(GOLDEN.step + 2))).toBeNull();
    });
  });

  it("tells how long the batch still covers", () => {
    expect(batchRemainingMs(BATCH, at(GOLDEN.step))).toBe(50_000);
    expect(batchRemainingMs(BATCH, at(GOLDEN.step + 5))).toBe(0);
  });

  it("computes time steps", () => {
    expect(entryQrStep(new Date(59_999), 30)).toBe(1);
  });

  describe("base64UrlToBytes", () => {
    it("decodes unpadded base64url", () => {
      expect(Array.from(base64UrlToBytes("AQID_-8") ?? [])).toEqual([
        1, 2, 3, 255, 239,
      ]);
      expect(base64UrlToBytes(GOLDEN.publicKey)?.length).toBe(32);
    });

    it("rejects foreign characters and impossible lengths", () => {
      expect(base64UrlToBytes("a+b/")).toBeNull();
      expect(base64UrlToBytes("abcde")).toBeNull();
    });
  });

  describe("claimsEntryQr (#668)", () => {
    it("is true for anything presented as a rotating QR, even malformed", () => {
      expect(claimsEntryQr(JSON.stringify({ v: 3 }))).toBe(true);
    });

    it("is false for static QRs and raw content", () => {
      expect(claimsEntryQr(JSON.stringify({ v: 2, id: "FFD-1" }))).toBe(false);
      expect(claimsEntryQr(JSON.stringify({ id: "FFD-1" }))).toBe(false);
      expect(claimsEntryQr("FFD-1")).toBe(false);
      expect(claimsEntryQr("null")).toBe(false);
    });
  });
});
