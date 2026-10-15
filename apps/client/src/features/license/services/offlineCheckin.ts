import { Alert } from "react-native";
import type { ReplayDecision } from "../../../hooks/useOfflineQueue";
import { EntryQrApi } from "../../../services/api/entry-qr-api";
import {
  enqueueMutation,
  type PendingMutation,
} from "../../../services/offlineQueueStorage";
import { createLogger } from "../../../utils/logger";
import { verifyEntryQrOffline, type EntryQrKeySet } from "../utils/entryQr";
import { loadEntryQrKeys, saveEntryQrKeys } from "../utils/entryQrStorage";

/**
 * Offline check-in (#24, ADR-0024).
 *
 * Without network, a scanner verifies a rotating entry QR (v3) with the
 * public keys downloaded beforehand: signature + freshness. A valid scan is
 * shown at once (holder name, from the signed QR) and queued; on reconnect
 * the queue replays it with its scan time, and the server checks the
 * registration and fees then. A static QR (Wallet pass, older app) cannot be
 * verified offline.
 */
const log = createLogger("offlineCheckin");

export const CHECKIN_KIND = "checkin";

export type OfflineCheckinStatus =
  | "VALID"
  | "STALE"
  | "INVALID_SIGNATURE"
  | "NOT_ENTRY_QR"
  /** No public key cached on this device yet. */
  | "NO_KEYS";

export interface OfflineCheckinResult {
  status: OfflineCheckinStatus;
  holderName?: string;
  licenseNumber?: string;
  /** True when the check-in was queued for the next reconnect. */
  queued: boolean;
}

export const OFFLINE_CHECKIN_MESSAGES = {
  VALID_QUEUED:
    "Licence authentique. Le check-in sera envoyé dès le retour du réseau : l'inscription et les droits seront vérifiés à ce moment-là.",
  VALID_NOT_QUEUED:
    "Licence authentique, mais aucune compétition identifiée : le check-in n'a pas pu être mis en attente.",
  STALE:
    "QR périmé : le QR d'entrée change toutes les 30 secondes. Capture d'écran, ou heure du téléphone décalée : demandez à rouvrir l'E-Licence.",
  INVALID_SIGNATURE: "QR invalide : sa signature ne correspond pas.",
  NOT_ENTRY_QR:
    "Ce QR (pass Wallet ou ancienne version de l'app) ne se vérifie qu'avec du réseau. Demandez à ouvrir l'E-Licence dans l'application.",
  NO_KEYS:
    "Vérification hors ligne impossible : ouvrez le scanner une fois avec du réseau pour télécharger les clés de vérification.",
  REPLAY_REJECTED_TITLE: "Check-in hors ligne refusé",
} as const;

/**
 * Downloads the public keys when the network allows and caches them; falls
 * back to the cached ones. Called when a scanner opens.
 */
export async function refreshEntryQrKeys(): Promise<EntryQrKeySet | null> {
  const fresh = await EntryQrApi.getKeys();
  if (fresh && fresh.keys.length > 0) {
    await saveEntryQrKeys(fresh);
    return fresh;
  }
  return loadEntryQrKeys();
}

interface OfflineCheckinRequest {
  qrData: string;
  /** "POST /path" replayed on reconnect; null ⇒ verify only, nothing queued. */
  endpoint: string | null;
  /** DTO fields sent with `qrData` and `scannedAt` (volunteer token…). */
  payload?: Record<string, string>;
  competitionId?: string | null;
  now?: Date;
}

export async function checkInOffline({
  qrData,
  endpoint,
  payload = {},
  competitionId,
  now = new Date(),
}: OfflineCheckinRequest): Promise<OfflineCheckinResult> {
  const keySet = await loadEntryQrKeys();
  if (!keySet || keySet.keys.length === 0) {
    return { status: "NO_KEYS", queued: false };
  }
  const verdict = verifyEntryQrOffline(qrData, keySet, now);
  if (verdict.status !== "VALID") {
    return {
      status: verdict.status,
      holderName: "holderName" in verdict ? verdict.holderName : undefined,
      licenseNumber:
        "licenseNumber" in verdict ? verdict.licenseNumber : undefined,
      queued: false,
    };
  }
  let queued = false;
  if (endpoint && competitionId) {
    const result = await enqueueMutation({
      endpoint,
      payload: { ...payload, qrData, scannedAt: now.toISOString() },
      queryKeysToInvalidate: [],
      kind: CHECKIN_KIND,
      // Scanning the same licence twice offline queues it once.
      collapseKey: `checkin:${competitionId}:${verdict.licenseId}`,
      meta: { holderName: verdict.holderName },
    });
    queued = result !== "collapsed";
    log.info(`Offline check-in ${result}`);
  }
  return {
    status: "VALID",
    holderName: verdict.holderName,
    licenseNumber: verdict.licenseNumber,
    queued,
  };
}

function httpStatusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const response = (err as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : null;
}

function serverMessageOf(err: unknown): string | null {
  const data = (err as { response?: { data?: { message?: unknown } } }).response
    ?.data;
  return typeof data?.message === "string" ? data.message : null;
}

/**
 * Replay classification of a queued check-in: an HTTP refusal (QR refused,
 * not registered, link expired…) is final and told to the staff; network
 * errors, 408, 429 and 5xx are retried at the next reconnect.
 */
export function handleCheckinReplayError(
  m: PendingMutation,
  err: unknown,
): ReplayDecision | undefined {
  if (m.kind !== CHECKIN_KIND) return undefined;
  const status = httpStatusOf(err);
  if (status === null || status === 408 || status === 429 || status >= 500) {
    return "retry";
  }
  const who = m.meta?.holderName ? `${m.meta.holderName} : ` : "";
  Alert.alert(
    OFFLINE_CHECKIN_MESSAGES.REPLAY_REJECTED_TITLE,
    `${who}${serverMessageOf(err) ?? "refusé par le serveur"}`,
  );
  return "drop";
}
