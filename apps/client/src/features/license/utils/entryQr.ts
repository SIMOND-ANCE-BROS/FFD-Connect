import { ed25519 } from "@noble/curves/ed25519";

/**
 * QR d'entrée tournant (v3, #24 — ADR-0024), côté application.
 *
 * - Le licencié affiche le QR du pas de temps courant (30 s), tiré d'un lot
 *   de jetons signés par le serveur (`GET /licenses/my/entry-qr`).
 * - Un scanner le vérifie SANS RÉSEAU avec les seules clés publiques
 *   (`GET /licenses/entry-qr/keys`), à ±1 pas de son horloge.
 *
 * Miroir exact de apps/backend/src/licenses/qr/entry-qr.ts : le contenu
 * signé (canonicalEntryQrContent) doit rester identique à l'octet près — le
 * vecteur de référence partagé (entryQr.test.ts) le vérifie.
 */

export const ENTRY_QR_VERSION = 3;
const ENTRY_QR_DOMAIN = "ffd-entry-qr";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const FIELD_MAX_LENGTH = 64;

/** Lot reçu du serveur (dates en ISO, telles que sérialisées). */
export interface EntryQrBatch {
  version: number;
  keyId: string;
  licenseId: string;
  number: string;
  holderName: string;
  stepSeconds: number;
  toleranceSteps: number;
  firstStep: number;
  signatures: string[];
  coversUntil: string;
}

export interface EntryQrPublicKey {
  kid: string;
  publicKey: string;
  active: boolean;
}

export interface EntryQrKeySet {
  version: number;
  stepSeconds: number;
  toleranceSteps: number;
  keys: EntryQrPublicKey[];
}

export interface EntryQrPayload {
  v: number;
  k: string;
  id: string;
  lid: string;
  nm: string;
  t: number;
  sig: string;
}

/** Pas de temps contenant `instant`. */
export function entryQrStep(instant: Date, stepSeconds: number): number {
  return Math.floor(instant.getTime() / 1000 / stepSeconds);
}

/** Contenu couvert par la signature (identique au backend). */
export function canonicalEntryQrContent(payload: EntryQrPayload): string {
  return JSON.stringify([
    ENTRY_QR_DOMAIN,
    ENTRY_QR_VERSION,
    payload.k,
    payload.lid,
    payload.id,
    payload.nm,
    payload.t,
  ]);
}

export interface CurrentEntryQr {
  /** Contenu à encoder dans le QR. */
  qrData: string;
  /** Secondes avant le prochain QR. */
  secondsLeft: number;
}

/**
 * QR du pas courant, ou null si le lot ne couvre pas `now` (lot épuisé,
 * horloge du téléphone hors du lot) : l'appelant retombe alors sur le QR
 * statique.
 */
export function currentEntryQr(
  batch: EntryQrBatch,
  now: Date,
): CurrentEntryQr | null {
  const step = entryQrStep(now, batch.stepSeconds);
  const signature = batch.signatures[step - batch.firstStep];
  if (step < batch.firstStep || !signature) return null;
  const payload: EntryQrPayload = {
    v: ENTRY_QR_VERSION,
    k: batch.keyId,
    id: batch.number,
    lid: batch.licenseId,
    nm: batch.holderName,
    t: step,
    sig: signature,
  };
  const nextStepAt = (step + 1) * batch.stepSeconds * 1000;
  return {
    qrData: JSON.stringify(payload),
    secondsLeft: Math.max(1, Math.ceil((nextStepAt - now.getTime()) / 1000)),
  };
}

/** Durée encore couverte par le lot, en millisecondes (0 si épuisé). */
export function batchRemainingMs(batch: EntryQrBatch, now: Date): number {
  return Math.max(0, new Date(batch.coversUntil).getTime() - now.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value.length <= FIELD_MAX_LENGTH
  );
}

/** Lit un QR v3 ; null si ce n'est pas un QR tournant bien formé. */
export function parseEntryQr(qrData: string): EntryQrPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(qrData);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== ENTRY_QR_VERSION) return null;
  const { k, id, lid, nm, t, sig } = parsed;
  if (
    typeof k !== "string" ||
    !KEY_ID_PATTERN.test(k) ||
    !isBoundedString(id) ||
    !isBoundedString(lid) ||
    typeof nm !== "string" ||
    nm.length > FIELD_MAX_LENGTH ||
    typeof t !== "number" ||
    !Number.isSafeInteger(t) ||
    t < 0 ||
    typeof sig !== "string" ||
    !SIGNATURE_PATTERN.test(sig)
  ) {
    return null;
  }
  return { v: ENTRY_QR_VERSION, k, id, lid, nm, t, sig };
}

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Décodage base64url sans padding (pas de Buffer en React Native). */
export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of value) {
    buffer = (buffer << 6) | BASE64URL.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

export type OfflineEntryQrResult =
  | {
      status: "VALID";
      holderName: string;
      licenseNumber: string;
      licenseId: string;
    }
  /** QR tournant authentique mais hors de sa fenêtre : capture rejouée ou horloge décalée. */
  | { status: "STALE"; holderName: string; licenseNumber: string }
  /** Signature fausse ou clé inconnue : QR falsifié. */
  | { status: "INVALID_SIGNATURE" }
  /** Pas un QR tournant (QR statique, pass Wallet…) : vérification en ligne requise. */
  | { status: "NOT_ENTRY_QR" };

/**
 * Vérification hors ligne d'un QR scanné : signature Ed25519 avec la clé
 * publique désignée par `k`, PUIS fraîcheur (±toleranceSteps pas).
 */
/**
 * Le QR se présente comme un QR tournant (v3), bien formé ou non. Faux pour
 * un QR statique (v1/v2, pass Wallet, ancienne app) ou un contenu brut.
 */
export function claimsEntryQr(qrData: string): boolean {
  try {
    const raw: unknown = JSON.parse(qrData);
    return isRecord(raw) && raw.v === ENTRY_QR_VERSION;
  } catch {
    // Contenu brut : pas un QR tournant.
    return false;
  }
}

export function verifyEntryQrOffline(
  qrData: string,
  keySet: EntryQrKeySet,
  now: Date,
): OfflineEntryQrResult {
  const payload = parseEntryQr(qrData);
  if (!payload) {
    return claimsEntryQr(qrData)
      ? { status: "INVALID_SIGNATURE" }
      : { status: "NOT_ENTRY_QR" };
  }
  const key = keySet.keys.find((candidate) => candidate.kid === payload.k);
  const publicKey = key ? base64UrlToBytes(key.publicKey) : null;
  const signature = base64UrlToBytes(payload.sig);
  if (publicKey?.length !== 32 || signature?.length !== 64) {
    return { status: "INVALID_SIGNATURE" };
  }
  let valid = false;
  try {
    valid = ed25519.verify(
      signature,
      new TextEncoder().encode(canonicalEntryQrContent(payload)),
      publicKey,
      { zip215: false },
    );
  } catch {
    valid = false;
  }
  if (!valid) return { status: "INVALID_SIGNATURE" };
  const drift = Math.abs(entryQrStep(now, keySet.stepSeconds) - payload.t);
  if (drift > keySet.toleranceSteps) {
    return {
      status: "STALE",
      holderName: payload.nm,
      licenseNumber: payload.id,
    };
  }
  return {
    status: "VALID",
    holderName: payload.nm,
    licenseNumber: payload.id,
    licenseId: payload.lid,
  };
}
