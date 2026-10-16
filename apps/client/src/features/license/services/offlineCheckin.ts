import { Alert } from "react-native";
import type { ReplayDecision } from "../../../hooks/useOfflineQueue";
import { competitionsControllerFindOne } from "../../../api/generated";
import api from "../../../services/api";
import { EntryQrApi } from "../../../services/api/entry-qr-api";
import {
  enqueueMutation,
  loadQueue,
  removeMutations,
  type PendingMutation,
} from "../../../services/offlineQueueStorage";
import { createLogger } from "../../../utils/logger";
import {
  loadCheckinPolicy,
  saveCheckinPolicy,
} from "../utils/checkinPolicyStorage";
import {
  claimsEntryQr,
  verifyEntryQrOffline,
  type EntryQrKeySet,
} from "../utils/entryQr";
import { loadEntryQrKeys, saveEntryQrKeys } from "../utils/entryQrStorage";

/**
 * Offline check-in (#24, ADR-0024).
 *
 * Without network, a scanner verifies a rotating entry QR (v3) with the
 * public keys downloaded beforehand: signature + freshness. A valid scan is
 * shown at once (holder name, from the signed QR) and queued; on reconnect
 * the queue replays it with its scan time, and the server checks the
 * registration and fees then. A static QR (Wallet pass, older app) cannot be
 * verified offline; at a competition that makes the rotating QR mandatory
 * (#668, policy cached when the scanner opened online) it is refused outright,
 * with the server's wording.
 */
const log = createLogger("offlineCheckin");

export const CHECKIN_KIND = "checkin";

export type OfflineCheckinStatus =
  | "VALID"
  | "STALE"
  | "INVALID_SIGNATURE"
  | "NOT_ENTRY_QR"
  /** Static QR at a competition requiring the rotating QR (#668). */
  | "STATIC_QR_REFUSED"
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
  /** Same wording as the server (STATIC_QR_REFUSED_MESSAGE, #668). */
  STATIC_QR_REFUSED:
    "QR statique refusé : présentez le QR tournant de l'E-Licence",
  NO_KEYS:
    "Vérification hors ligne impossible : ouvrez le scanner avec du réseau pour télécharger les clés de vérification (elles expirent après 7 jours sans réseau).",
  REPLAY_REJECTED_TITLE: "Check-in hors ligne refusé",
  REPLAY_EXPIRED:
    "Scan hors ligne de plus de 12 h : il n'a pas été envoyé. Refaites le check-in en ligne si la personne est toujours là.",
  ALREADY_CHECKED_IN_TITLE: "QR peut-être utilisé deux fois",
  ALREADY_CHECKED_IN:
    "était déjà pointé(e) quand le scan hors ligne a été synchronisé : le même QR a peut-être servi à deux personnes. Vérifiez l'identité si possible.",
} as const;

/**
 * A queued check-in older than this is dropped, never sent: the server
 * refuses a claimed scan time older than 12 h anyway, and the entry may hold
 * a volunteer link token that must not linger on the device.
 */
export const OFFLINE_CHECKIN_MAX_AGE_MS = 12 * 3600 * 1000;

export class OfflineCheckinExpiredError extends Error {
  constructor() {
    super("Offline check-in older than 12 h");
    this.name = "OfflineCheckinExpiredError";
  }
}

const isExpired = (m: PendingMutation, now: number): boolean =>
  now - m.enqueuedAt > OFFLINE_CHECKIN_MAX_AGE_MS;

/**
 * Removes queued check-ins older than 12 h (and the volunteer tokens they
 * carry). Called when a scanner opens; the replay drops them too.
 */
export async function purgeExpiredCheckins(
  now: Date = new Date(),
): Promise<number> {
  const expired = (await loadQueue()).filter(
    (m) => m.kind === CHECKIN_KIND && isExpired(m, now.getTime()),
  );
  await removeMutations(expired.map((m) => m.id));
  if (expired.length > 0) {
    log.info(`Purged ${expired.length} expired offline check-in(s)`);
  }
  return expired.length;
}

interface ReplayResponse {
  registrations?: { status?: string }[];
}

/**
 * Replays one queued check-in (mutationFn of the offline queue for
 * CHECKIN_KIND). An entry older than 12 h is never sent. When the server
 * answers ALREADY_CHECKED_IN, the licence was checked in meanwhile — by a
 * concurrent scan of the same token, possibly a shared screenshot: the staff
 * is told so.
 */
export async function replayCheckin(
  request: { endpoint: string; payload: unknown },
  m: PendingMutation,
  now: Date = new Date(),
): Promise<void> {
  if (isExpired(m, now.getTime())) throw new OfflineCheckinExpiredError();
  const [, path] = request.endpoint.split(" ");
  const response = await api.post<ReplayResponse>(path, request.payload);
  const already = (response.data.registrations ?? []).some(
    (r) => r.status === "ALREADY_CHECKED_IN",
  );
  if (already) {
    Alert.alert(
      OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN_TITLE,
      `${m.meta?.holderName ?? "Ce licencié"} ${OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN}`,
    );
  }
}

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

/**
 * Downloads the competition's check-in policy (#668) when the network allows
 * and caches it, so that it applies offline too; falls back to the cached
 * one. Called when a scanner opens, next to the keys. The endpoint is public:
 * a volunteer has no account.
 */
export async function refreshCheckinPolicy(
  competitionId: string,
): Promise<boolean | null> {
  try {
    const result = await competitionsControllerFindOne({
      path: { id: competitionId },
    });
    const requireRotatingQr = result.data?.requireRotatingQr;
    if (typeof requireRotatingQr === "boolean") {
      await saveCheckinPolicy(competitionId, { requireRotatingQr });
      return requireRotatingQr;
    }
  } catch {
    // Offline: the cached policy applies.
  }
  return (await loadCheckinPolicy(competitionId))?.requireRotatingQr ?? null;
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
  // Rotating QR mandatory (#668): a static QR is refused whatever the keys.
  if (competitionId && !claimsEntryQr(qrData)) {
    const policy = await loadCheckinPolicy(competitionId);
    if (policy?.requireRotatingQr) {
      return { status: "STATIC_QR_REFUSED", queued: false };
    }
  }
  const keySet = await loadEntryQrKeys(now);
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
  const who = m.meta?.holderName ? `${m.meta.holderName} : ` : "";
  if (err instanceof OfflineCheckinExpiredError) {
    Alert.alert(
      OFFLINE_CHECKIN_MESSAGES.REPLAY_REJECTED_TITLE,
      `${who}${OFFLINE_CHECKIN_MESSAGES.REPLAY_EXPIRED}`,
    );
    return "drop";
  }
  const status = httpStatusOf(err);
  if (status === null || status === 408 || status === 429 || status >= 500) {
    return "retry";
  }
  Alert.alert(
    OFFLINE_CHECKIN_MESSAGES.REPLAY_REJECTED_TITLE,
    `${who}${serverMessageOf(err) ?? "refusé par le serveur"}`,
  );
  return "drop";
}
