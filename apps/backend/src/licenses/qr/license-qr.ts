import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed license QR code (#168).
 *
 * The QR content is a compact JSON object:
 *
 *   {"v":1,"id":"<license number>","exp":"YYYY-MM-DD","sig":"<base64url>"}
 *
 * - `id` keeps the key the check-in has always read, so a backend that does
 *   not know about signatures still resolves a signed QR.
 * - `exp` is the license end-of-validity date (UTC day). The QR stays valid
 *   until then: it is meant to be copied as-is into a static Wallet pass.
 * - `sig` is an HMAC-SHA256 over a canonical, versioned string built from the
 *   fields above — never over the raw QR bytes, so re-serialising the JSON
 *   (key order, whitespace) does not break verification.
 *
 * Everything in this file is pure (no Nest, no config) so a future Wallet
 * pass generator can produce exactly the same QR content.
 */

export const LICENSE_QR_VERSION = 1;

/** Domain separator: a signature made for another purpose can never match. */
const LICENSE_QR_DOMAIN = "ffd-license-qr";

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface LicenseQrSubject {
  /** License number (the identifier the check-in resolves). */
  number: string;
  /** End of validity of the license. */
  validUntil: Date;
}

export interface SignedLicenseQrPayload {
  v: number;
  id: string;
  exp: string;
  sig: string;
}

/** UTC calendar day of the license end-of-validity, `YYYY-MM-DD`. */
export function toLicenseQrExpiry(validUntil: Date): string {
  return validUntil.toISOString().slice(0, 10);
}

/**
 * Canonical string covered by the signature. JSON array encoding makes the
 * field boundaries unambiguous whatever characters the license number holds.
 */
export function canonicalLicenseQrContent(
  version: number,
  licenseNumber: string,
  expiry: string,
): string {
  return JSON.stringify([LICENSE_QR_DOMAIN, version, licenseNumber, expiry]);
}

function computeSignature(content: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(content, "utf8").digest();
}

/** Builds the signed QR content (string to encode in the QR code). */
export function buildSignedLicenseQr(
  subject: LicenseQrSubject,
  secret: string,
): string {
  const exp = toLicenseQrExpiry(subject.validUntil);
  const sig = computeSignature(
    canonicalLicenseQrContent(LICENSE_QR_VERSION, subject.number, exp),
    secret,
  ).toString("base64url");
  const payload: SignedLicenseQrPayload = {
    v: LICENSE_QR_VERSION,
    id: subject.number,
    exp,
    sig,
  };
  return JSON.stringify(payload);
}

export type ParsedLicenseQr =
  | {
      kind: "signed";
      /** Identifier claimed by the QR (license number). */
      identifier: string;
      payload: SignedLicenseQrPayload;
    }
  | {
      kind: "malformed-signed";
      /** Best-effort identifier, may be empty. */
      identifier: string;
    }
  | {
      kind: "unsigned";
      /** Legacy content: `id` of the JSON, or the raw string itself. */
      identifier: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a scanned QR string without verifying anything. */
export function parseLicenseQr(qrData: string): ParsedLicenseQr {
  let parsed: unknown;
  try {
    parsed = JSON.parse(qrData);
  } catch {
    // Raw identifier (license number or user id)
    return { kind: "unsigned", identifier: qrData };
  }
  if (!isRecord(parsed)) {
    return { kind: "unsigned", identifier: qrData };
  }

  const id = typeof parsed.id === "string" ? parsed.id : "";

  if (!("sig" in parsed)) {
    return { kind: "unsigned", identifier: id || qrData };
  }

  const { v, exp, sig } = parsed;
  if (
    typeof v !== "number" ||
    typeof exp !== "string" ||
    typeof sig !== "string" ||
    id === ""
  ) {
    return { kind: "malformed-signed", identifier: id };
  }
  return { kind: "signed", identifier: id, payload: { v, id, exp, sig } };
}

export type SignedLicenseQrStatus = "VALID" | "INVALID_SIGNATURE" | "EXPIRED";

/**
 * Verifies a signed payload: version, signature (constant-time), then expiry.
 * A wrong signature always wins over expiry: an attacker learns nothing.
 */
export function verifySignedLicenseQr(
  payload: SignedLicenseQrPayload,
  secret: string,
  now: Date = new Date(),
): SignedLicenseQrStatus {
  if (payload.v !== LICENSE_QR_VERSION || !EXPIRY_PATTERN.test(payload.exp)) {
    return "INVALID_SIGNATURE";
  }
  const expected = computeSignature(
    canonicalLicenseQrContent(payload.v, payload.id, payload.exp),
    secret,
  );
  const provided = Buffer.from(payload.sig, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return "INVALID_SIGNATURE";
  }
  const endOfValidity = Date.parse(`${payload.exp}T23:59:59.999Z`);
  if (Number.isNaN(endOfValidity) || now.getTime() > endOfValidity) {
    return "EXPIRED";
  }
  return "VALID";
}
