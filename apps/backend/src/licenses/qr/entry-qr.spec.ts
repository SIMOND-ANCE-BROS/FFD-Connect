import { createPublicKey, generateKeyPairSync, KeyObject } from "crypto";
import {
  buildEntryQr,
  canonicalEntryQrContent,
  ENTRY_QR_NAME_MAX_LENGTH,
  ENTRY_QR_STEP_SECONDS,
  ENTRY_QR_TOLERANCE_STEPS,
  ENTRY_QR_VERSION,
  EntryQrPayload,
  entryQrHolderName,
  entryQrKeyId,
  entryQrStep,
  entryQrStepStart,
  parseEntryQr,
  publicKeyFromRaw,
  rawEd25519PublicKey,
  signEntryQrStep,
  verifyEntryQr,
} from "./entry-qr";
import {
  ACTIVE_TEST_KEY_LABEL,
  ENTRY_QR_GOLDEN_VECTOR as GOLDEN,
  testEntryQrPrivateKey,
} from "./entry-qr-test-keys.mock";

const PRIVATE_KEY = testEntryQrPrivateKey(ACTIVE_TEST_KEY_LABEL);
const RAW_PUBLIC = rawEd25519PublicKey(createPublicKey(PRIVATE_KEY));
const KID = entryQrKeyId(RAW_PUBLIC);
const KEYS = new Map<string, KeyObject>([[KID, createPublicKey(PRIVATE_KEY)]]);
const SUBJECT = GOLDEN.subject;
const STEP = GOLDEN.step;
/** Middle of the golden step. */
const AT_STEP = new Date((STEP * ENTRY_QR_STEP_SECONDS + 15) * 1000);

function payloadFor(step = STEP, subject = SUBJECT): EntryQrPayload {
  const parsed = parseEntryQr(
    buildEntryQr(
      KID,
      subject,
      step,
      signEntryQrStep(PRIVATE_KEY, KID, subject, step),
    ),
  );
  if (parsed.kind !== "entry") throw new Error("expected an entry QR");
  return parsed.payload;
}

describe("entry QR (v3, #24)", () => {
  describe("golden vector (shared with the client verifier)", () => {
    it("derives the published public key and key id", () => {
      expect(RAW_PUBLIC).toBe(GOLDEN.publicKey);
      expect(KID).toBe(GOLDEN.keyId);
    });

    it("signs the canonical content deterministically", () => {
      expect(canonicalEntryQrContent(KID, SUBJECT, STEP)).toBe(
        GOLDEN.canonical,
      );
      expect(signEntryQrStep(PRIVATE_KEY, KID, SUBJECT, STEP)).toBe(
        GOLDEN.signature,
      );
    });

    it("builds the documented QR shape", () => {
      expect(
        JSON.parse(buildEntryQr(KID, SUBJECT, STEP, GOLDEN.signature)),
      ).toEqual({
        v: ENTRY_QR_VERSION,
        k: GOLDEN.keyId,
        id: SUBJECT.number,
        lid: SUBJECT.licenseId,
        nm: SUBJECT.holderName,
        t: STEP,
        sig: GOLDEN.signature,
      });
    });
  });

  describe("time steps", () => {
    it("cuts time into 30-second steps", () => {
      expect(ENTRY_QR_STEP_SECONDS).toBe(30);
      expect(entryQrStep(new Date(0))).toBe(0);
      expect(entryQrStep(new Date(29_999))).toBe(0);
      expect(entryQrStep(new Date(30_000))).toBe(1);
      expect(entryQrStepStart(2).toISOString()).toBe(
        "1970-01-01T00:01:00.000Z",
      );
    });
  });

  describe("entryQrHolderName", () => {
    it("formats LASTNAME Firstname", () => {
      expect(entryQrHolderName(" Jean ", " Dupont ")).toBe("DUPONT Jean");
    });

    it("cuts long names", () => {
      const name = entryQrHolderName("a".repeat(80), "b".repeat(80));
      expect(name).toHaveLength(ENTRY_QR_NAME_MAX_LENGTH);
    });
  });

  describe("keys", () => {
    it("round-trips a raw public key", () => {
      const key = publicKeyFromRaw(RAW_PUBLIC);
      expect(key).not.toBeNull();
      expect(rawEd25519PublicKey(key as KeyObject)).toBe(RAW_PUBLIC);
    });

    it.each(["", "short", "!".repeat(43), `${RAW_PUBLIC}A`])(
      "rejects a malformed raw key %p",
      (raw) => {
        expect(publicKeyFromRaw(raw)).toBeNull();
      },
    );

    it("refuses to export a non-Ed25519 key", () => {
      const { publicKey } = generateKeyPairSync("x25519");
      expect(() => rawEd25519PublicKey(publicKey)).toThrow(
        "Not an Ed25519 key",
      );
    });
  });

  describe("parseEntryQr", () => {
    it("leaves anything that is not v3 to the other parsers", () => {
      expect(parseEntryQr("FFD-123456")).toEqual({ kind: "other" });
      expect(parseEntryQr("[3]")).toEqual({ kind: "other" });
      expect(parseEntryQr("null")).toEqual({ kind: "other" });
      expect(
        parseEntryQr(JSON.stringify({ v: 2, id: "FFD-1", sig: "x" })),
      ).toEqual({ kind: "other" });
    });

    it("parses a well-formed v3 QR", () => {
      expect(payloadFor()).toEqual({
        v: 3,
        k: KID,
        id: SUBJECT.number,
        lid: SUBJECT.licenseId,
        nm: SUBJECT.holderName,
        t: STEP,
        sig: GOLDEN.signature,
      });
    });

    const base = JSON.parse(
      buildEntryQr(KID, SUBJECT, STEP, GOLDEN.signature),
    ) as Record<string, unknown>;
    it.each<[string, Record<string, unknown>]>([
      ["a bad key id", { k: "short" }],
      ["a non-string key id", { k: 1 }],
      ["an empty number", { id: "" }],
      ["a missing number", { id: undefined }],
      ["a too long number", { id: "x".repeat(65) }],
      ["a missing licence id", { lid: undefined }],
      ["a too long licence id", { lid: "x".repeat(65) }],
      ["a non-string name", { nm: 1 }],
      ["a too long name", { nm: "x".repeat(65) }],
      ["a string step", { t: "59612345" }],
      ["a fractional step", { t: 1.5 }],
      ["a negative step", { t: -1 }],
      ["a short signature", { sig: "abc" }],
      ["a non-string signature", { sig: 12 }],
    ])("flags %s as malformed", (_label, override) => {
      const parsed = parseEntryQr(JSON.stringify({ ...base, ...override }));
      expect(parsed.kind).toBe("malformed");
    });

    it("keeps the claimed number of a malformed QR", () => {
      expect(parseEntryQr(JSON.stringify({ ...base, sig: "x" }))).toEqual({
        kind: "malformed",
        identifier: SUBJECT.number,
      });
      expect(parseEntryQr(JSON.stringify({ ...base, id: 7 }))).toEqual({
        kind: "malformed",
        identifier: "",
      });
    });
  });

  describe("verifyEntryQr", () => {
    it("accepts the QR of the current step", () => {
      expect(verifyEntryQr(payloadFor(), KEYS, AT_STEP)).toBe("VALID");
    });

    it(`accepts ±${ENTRY_QR_TOLERANCE_STEPS} step of clock drift`, () => {
      expect(verifyEntryQr(payloadFor(STEP - 1), KEYS, AT_STEP)).toBe("VALID");
      expect(verifyEntryQr(payloadFor(STEP + 1), KEYS, AT_STEP)).toBe("VALID");
    });

    it("refuses a capture replayed two steps later, or a QR from the future", () => {
      expect(verifyEntryQr(payloadFor(STEP - 2), KEYS, AT_STEP)).toBe("STALE");
      expect(verifyEntryQr(payloadFor(STEP + 2), KEYS, AT_STEP)).toBe("STALE");
    });

    it("uses the current time by default", () => {
      const now = entryQrStep(new Date());
      expect(verifyEntryQr(payloadFor(now), KEYS)).toBe("VALID");
    });

    it.each<[string, Partial<EntryQrPayload>]>([
      ["number", { id: "FFD-999999" }],
      ["licence id", { lid: "other-licence" }],
      ["holder name", { nm: "MARTIN Paul" }],
      ["time step", { t: STEP + 1 }],
    ])("refuses a QR whose %s was changed", (_label, override) => {
      expect(
        verifyEntryQr({ ...payloadFor(), ...override }, KEYS, AT_STEP),
      ).toBe("INVALID_SIGNATURE");
    });

    it("reports a forgery as such even when it is also stale", () => {
      const forged = { ...payloadFor(STEP - 10), nm: "MARTIN Paul" };
      expect(verifyEntryQr(forged, KEYS, AT_STEP)).toBe("INVALID_SIGNATURE");
    });

    it("refuses an unknown key id", () => {
      expect(
        verifyEntryQr({ ...payloadFor(), k: "AAAAAAAAAAA" }, KEYS, AT_STEP),
      ).toBe("INVALID_SIGNATURE");
    });

    it("refuses a signature made by another key under a known key id", () => {
      const other = testEntryQrPrivateKey("another key");
      const sig = signEntryQrStep(other, KID, SUBJECT, STEP);
      expect(verifyEntryQr({ ...payloadFor(), sig }, KEYS, AT_STEP)).toBe(
        "INVALID_SIGNATURE",
      );
    });

    it("refuses a key id pointing at a key the signature cannot be checked with", () => {
      const { publicKey } = generateKeyPairSync("x25519");
      const keys = new Map<string, KeyObject>([[KID, publicKey]]);
      expect(verifyEntryQr(payloadFor(), keys, AT_STEP)).toBe(
        "INVALID_SIGNATURE",
      );
    });
  });
});
