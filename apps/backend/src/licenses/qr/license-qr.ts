import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed license QR code (#168, bound to the licence itself since #466).
 *
 * The QR content is a compact JSON object:
 *
 *   {"v":2,"id":"<license number>","lid":"<license id>","exp":"YYYY-MM-DD","sig":"<base64url>"}
 *
 * - `id` keeps the key the check-in has always read, so a backend that does
 *   not know about signatures still resolves a signed QR.
 * - `lid` (v2) is the internal licence id, stable when an administrator
 *   renames the licence number (#448). The check-in only accepts the QR for
 *   the licence it was issued for: a number renamed then reassigned to
 *   someone else never resolves to its new holder (#466).
 * - v1 (`{"v":1,"id","exp","sig"}`, no `lid`) is still verified during the
 *   transition — it expires with the licence season — but is only bound to
 *   the number: the check-in applies the retired-number guard to it.
 * - `exp` is the license end-of-validity date, as a calendar day in
 *   Europe/Paris (the federation's time zone). The QR stays valid until the
 *   end of that day in Paris: it is meant to be copied as-is into a static
 *   Wallet pass.
 * - `sig` is an HMAC-SHA256 over a canonical, versioned string built from the
 *   fields above — never over the raw QR bytes, so re-serialising the JSON
 *   (key order, whitespace) does not break verification.
 *
 * Everything in this file is pure (no Nest, no config) so a future Wallet
 * pass generator can produce exactly the same QR content.
 *
 * Secret normalisation: the backend reads `QR_SIGNING_SECRET` and applies
 * `.trim()` before using it as the HMAC key (see LicenseQrService). Any other
 * producer (e.g. the Wallet pass generator) MUST pass the same trimmed value,
 * otherwise its signatures will not verify.
 */

/** Version produced today: binds the licence id (#466). */
export const LICENSE_QR_VERSION = 2;

/** Number-only signed QR (#168), still verified until it expires. */
export const LEGACY_LICENSE_QR_VERSION = 1;

/** Domain separator: a signature made for another purpose can never match. */
const LICENSE_QR_DOMAIN = "ffd-license-qr";

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Licence ids are UUIDs; anything longer is not a QR we issued. */
const LICENSE_ID_MAX_LENGTH = 64;

/** Unpadded base64url of a 32-byte HMAC-SHA256 digest. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Time zone the license validity day is expressed in. */
export const LICENSE_QR_TIME_ZONE = "Europe/Paris";

/** `en-CA` formats dates as `YYYY-MM-DD`. */
const PARIS_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: LICENSE_QR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day of an instant in Europe/Paris, `YYYY-MM-DD`. */
function parisDay(instant: Date): string {
  return PARIS_DAY_FORMAT.format(instant);
}

const PARIS_PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LICENSE_QR_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset of Europe/Paris from UTC at `instant`, in milliseconds. */
function parisOffsetMs(instant: number): number {
  const parts = PARIS_PARTS_FORMAT.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Instant at which the calendar day `day` (`YYYY-MM-DD`) ends in
 * Europe/Paris, i.e. midnight Paris time of the following day. Same rule as
 * the signed QR: valid until the end of its `exp` day in Paris.
 */
export function parisEndOfDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, date + 1);
  // Two passes: the offset at the guessed instant may differ by an hour
  // around a DST switch.
  let instant = midnightAsUtc - parisOffsetMs(midnightAsUtc);
  instant = midnightAsUtc - parisOffsetMs(instant);
  return new Date(instant);
}

/**
 * Instant at which the calendar day `day` (`YYYY-MM-DD`) starts in
 * Europe/Paris (midnight Paris time), i.e. the end of the previous day.
 */
export function parisStartOfDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const previousDay = new Date(Date.UTC(year, month - 1, date - 1))
    .toISOString()
    .slice(0, 10);
  return parisEndOfDay(previousDay);
}

/** True when `day` (`YYYY-MM-DD`) is a real calendar date. */
function isCalendarDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  );
}

export interface LicenseQrSubject {
  /** Internal licence id: stable across a number change (#466). */
  id: string;
  /** License number (the identifier the check-in resolves). */
  number: string;
  /** End of validity of the license. */
  validUntil: Date;
}

export interface SignedLicenseQrPayload {
  v: number;
  /** License number. */
  id: string;
  /** Licence id — v2 only, never read from a v1 QR (not signed there). */
  lid?: string;
  exp: string;
  sig: string;
}

/**
 * Calendar day (Europe/Paris) of the license end-of-validity, `YYYY-MM-DD`.
 * A license stored as 2026-08-30T22:00Z (midnight in Paris) expires on
 * 2026-08-31, not on the UTC day 2026-08-30.
 */
export function toLicenseQrExpiry(validUntil: Date): string {
  return parisDay(validUntil);
}

/**
 * Canonical string covered by the signature. JSON array encoding makes the
 * field boundaries unambiguous whatever characters the license number holds.
 * v1 covers version + number + expiry; v2 adds the licence id. The version is
 * part of the content, so a v1 signature can never pass for a v2 one.
 */
export function canonicalLicenseQrContent(
  version: number,
  licenseNumber: string,
  expiry: string,
  licenseId?: string,
): string {
  if (version === LEGACY_LICENSE_QR_VERSION) {
    return JSON.stringify([LICENSE_QR_DOMAIN, version, licenseNumber, expiry]);
  }
  return JSON.stringify([
    LICENSE_QR_DOMAIN,
    version,
    licenseNumber,
    licenseId ?? null,
    expiry,
  ]);
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
    canonicalLicenseQrContent(
      LICENSE_QR_VERSION,
      subject.number,
      exp,
      subject.id,
    ),
    secret,
  ).toString("base64url");
  const payload: SignedLicenseQrPayload = {
    v: LICENSE_QR_VERSION,
    id: subject.number,
    lid: subject.id,
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

  const { v, exp, sig, lid } = parsed;
  if (
    typeof v !== "number" ||
    typeof exp !== "string" ||
    typeof sig !== "string" ||
    id === ""
  ) {
    return { kind: "malformed-signed", identifier: id };
  }
  if (v === LEGACY_LICENSE_QR_VERSION) {
    // A `lid` slipped into a v1 QR is not covered by its signature: dropped.
    return { kind: "signed", identifier: id, payload: { v, id, exp, sig } };
  }
  if (
    typeof lid !== "string" ||
    lid === "" ||
    lid.length > LICENSE_ID_MAX_LENGTH
  ) {
    return { kind: "malformed-signed", identifier: id };
  }
  return { kind: "signed", identifier: id, payload: { v, id, lid, exp, sig } };
}

export type SignedLicenseQrStatus = "VALID" | "INVALID_SIGNATURE" | "EXPIRED";

/**
 * Verifies a signed payload: version (v1 or v2), signature format and value
 * (constant-time), then expiry — the QR is valid until the end of the `exp`
 * day in Europe/Paris. A wrong signature always wins over expiry: an attacker
 * learns nothing.
 */
export function verifySignedLicenseQr(
  payload: SignedLicenseQrPayload,
  secret: string,
  now: Date = new Date(),
): SignedLicenseQrStatus {
  if (
    (payload.v !== LICENSE_QR_VERSION &&
      payload.v !== LEGACY_LICENSE_QR_VERSION) ||
    (payload.v === LICENSE_QR_VERSION && !payload.lid) ||
    !EXPIRY_PATTERN.test(payload.exp) ||
    !SIGNATURE_PATTERN.test(payload.sig)
  ) {
    return "INVALID_SIGNATURE";
  }
  const expected = computeSignature(
    canonicalLicenseQrContent(payload.v, payload.id, payload.exp, payload.lid),
    secret,
  );
  const provided = Buffer.from(payload.sig, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return "INVALID_SIGNATURE";
  }
  // YYYY-MM-DD strings compare chronologically.
  if (!isCalendarDay(payload.exp) || parisDay(now) > payload.exp) {
    return "EXPIRED";
  }
  return "VALID";
}
