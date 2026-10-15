import {
  createHash,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "crypto";

/**
 * Rotating entry QR (v3, #24): verifiable OFFLINE, useless as a screenshot.
 *
 * The server signs, with an Ed25519 private key, one short-lived token per
 * 30-second time step and hands a batch of them to the licensee's phone
 * (`GET /licenses/my/entry-qr`). The phone shows the token of the current
 * step; a scanner verifies it with the PUBLIC key only (no secret on
 * scanners, no network needed), and accepts it within ±1 step of its clock.
 *
 *   {"v":3,"k":"<key id>","id":"<license number>","lid":"<license id>",
 *    "nm":"<holder name>","t":<time step>,"sig":"<base64url>"}
 *
 * - `id` keeps the key the check-in has always read (license number).
 * - `lid` binds the licence itself, as v2 does (#466).
 * - `nm` lets an offline scanner show who the QR belongs to (it cannot look
 *   the licence up): the volunteer compares it with the person in front.
 * - `t` is the time step: floor(unix seconds / ENTRY_QR_STEP_SECONDS).
 * - `k` identifies the signing key (rotation: retired keys stay verifiable).
 * - `sig` is an Ed25519 signature over `canonicalEntryQrContent(...)`, UTF-8 —
 *   never over the raw QR bytes. The client re-implements exactly this
 *   function (apps/client/src/features/license/utils/entryQr.ts): any change
 *   here is a new version.
 *
 * Pure (no Nest, no config). See docs/adr/0024-qr-entree-tournant-hors-ligne.md.
 */

export const ENTRY_QR_VERSION = 3;

/** Length of a time step: the QR shown on the phone changes this often. */
export const ENTRY_QR_STEP_SECONDS = 30;

/**
 * Steps accepted on each side of the verifier's current step: absorbs clock
 * drift between phone and scanner and the time it takes to scan. A captured
 * QR is therefore usable for at most (2 × tolerance + 1) steps, i.e. 90 s.
 */
export const ENTRY_QR_TOLERANCE_STEPS = 1;

/** How far ahead a batch reaches: a full competition day offline. */
export const ENTRY_QR_BATCH_HOURS = 12;

/** Domain separator: a signature made for another purpose never matches. */
const ENTRY_QR_DOMAIN = "ffd-entry-qr";

/** Holder names are cut to this length (QR density, minimisation). */
export const ENTRY_QR_NAME_MAX_LENGTH = 64;

const LICENSE_ID_MAX_LENGTH = 64;
const LICENSE_NUMBER_MAX_LENGTH = 64;
/** Key ids are 11 base64url chars (8 bytes of SHA-256). */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
/** Unpadded base64url of a 64-byte Ed25519 signature. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
/** Unpadded base64url of a 32-byte raw Ed25519 public key. */
const RAW_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410), before the 32 key bytes. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface EntryQrSubject {
  /** Internal licence id (#466). */
  licenseId: string;
  /** License number. */
  number: string;
  /** Holder display name, already formatted (`DUPONT Jean`). */
  holderName: string;
}

export interface EntryQrPayload {
  v: number;
  /** Key id. */
  k: string;
  /** License number. */
  id: string;
  lid: string;
  nm: string;
  t: number;
  sig: string;
}

/** Time step containing `instant`. */
export function entryQrStep(instant: Date): number {
  return Math.floor(instant.getTime() / 1000 / ENTRY_QR_STEP_SECONDS);
}

/** First instant of a time step. */
export function entryQrStepStart(step: number): Date {
  return new Date(step * ENTRY_QR_STEP_SECONDS * 1000);
}

/** Display name embedded in the QR: `LASTNAME Firstname`, cut to 64 chars. */
export function entryQrHolderName(firstName: string, lastName: string): string {
  return `${lastName.trim().toUpperCase()} ${firstName.trim()}`
    .trim()
    .slice(0, ENTRY_QR_NAME_MAX_LENGTH);
}

/** Raw 32-byte Ed25519 public key, base64url (what scanners download). */
export function rawEd25519PublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("Not an Ed25519 key");
  }
  return jwk.x;
}

/** Ed25519 public key from its raw base64url form, or null when malformed. */
export function publicKeyFromRaw(raw: string): KeyObject | null {
  if (!RAW_PUBLIC_KEY_PATTERN.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== 32) return null;
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

/** Key id: first 8 bytes of SHA-256 over the raw public key, base64url. */
export function entryQrKeyId(rawPublicKey: string): string {
  return createHash("sha256")
    .update(Buffer.from(rawPublicKey, "base64url"))
    .digest()
    .subarray(0, 8)
    .toString("base64url");
}

/**
 * String covered by the signature. A JSON array makes the field boundaries
 * unambiguous whatever characters the name or number hold; the version and
 * key id are part of it, so a token can never pass for another version or
 * another key.
 */
export function canonicalEntryQrContent(
  keyId: string,
  subject: EntryQrSubject,
  step: number,
): string {
  return JSON.stringify([
    ENTRY_QR_DOMAIN,
    ENTRY_QR_VERSION,
    keyId,
    subject.licenseId,
    subject.number,
    subject.holderName,
    step,
  ]);
}

/** Signature of one step, base64url. */
export function signEntryQrStep(
  privateKey: KeyObject,
  keyId: string,
  subject: EntryQrSubject,
  step: number,
): string {
  return cryptoSign(
    null,
    Buffer.from(canonicalEntryQrContent(keyId, subject, step), "utf8"),
    privateKey,
  ).toString("base64url");
}

/** QR content for one step (what the phone encodes in the QR code). */
export function buildEntryQr(
  keyId: string,
  subject: EntryQrSubject,
  step: number,
  signature: string,
): string {
  const payload: EntryQrPayload = {
    v: ENTRY_QR_VERSION,
    k: keyId,
    id: subject.number,
    lid: subject.licenseId,
    nm: subject.holderName,
    t: step,
    sig: signature,
  };
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value !== "" && value.length <= max;
}

export type ParsedEntryQr =
  /** Not a v3 QR: the caller handles it (v2, v1, legacy…). */
  | { kind: "other" }
  /** Claims v3 but its fields are unusable: never a valid QR. */
  | { kind: "malformed"; identifier: string }
  | { kind: "entry"; payload: EntryQrPayload };

/** Reads a scanned string as a v3 entry QR, without verifying anything. */
export function parseEntryQr(qrData: string): ParsedEntryQr {
  let parsed: unknown;
  try {
    parsed = JSON.parse(qrData);
  } catch {
    return { kind: "other" };
  }
  if (!isRecord(parsed) || parsed.v !== ENTRY_QR_VERSION) {
    return { kind: "other" };
  }
  const { k, id, lid, nm, t, sig } = parsed;
  const identifier = typeof id === "string" ? id : "";
  if (
    typeof k !== "string" ||
    !KEY_ID_PATTERN.test(k) ||
    !isBoundedString(id, LICENSE_NUMBER_MAX_LENGTH) ||
    !isBoundedString(lid, LICENSE_ID_MAX_LENGTH) ||
    typeof nm !== "string" ||
    nm.length > ENTRY_QR_NAME_MAX_LENGTH ||
    typeof t !== "number" ||
    !Number.isSafeInteger(t) ||
    t < 0 ||
    typeof sig !== "string" ||
    !SIGNATURE_PATTERN.test(sig)
  ) {
    return { kind: "malformed", identifier };
  }
  return {
    kind: "entry",
    payload: { v: ENTRY_QR_VERSION, k, id, lid, nm, t, sig },
  };
}

export type EntryQrStatus =
  | "VALID"
  /** Unknown key, or a signature that does not match. */
  | "INVALID_SIGNATURE"
  /** Genuine, but outside the accepted time window: replayed capture or wrong clock. */
  | "STALE";

/**
 * Verifies a parsed v3 QR against the known public keys (key id → key), at
 * `now`. The signature is checked BEFORE freshness: a forged QR is always
 * reported as such, whatever its step.
 */
export function verifyEntryQr(
  payload: EntryQrPayload,
  publicKeys: ReadonlyMap<string, KeyObject>,
  now: Date = new Date(),
): EntryQrStatus {
  const key = publicKeys.get(payload.k);
  if (!key) return "INVALID_SIGNATURE";
  const signature = Buffer.from(payload.sig, "base64url");
  const content = canonicalEntryQrContent(
    payload.k,
    { licenseId: payload.lid, number: payload.id, holderName: payload.nm },
    payload.t,
  );
  let valid = false;
  try {
    valid = cryptoVerify(null, Buffer.from(content, "utf8"), key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return "INVALID_SIGNATURE";
  if (Math.abs(entryQrStep(now) - payload.t) > ENTRY_QR_TOLERANCE_STEPS) {
    return "STALE";
  }
  return "VALID";
}
