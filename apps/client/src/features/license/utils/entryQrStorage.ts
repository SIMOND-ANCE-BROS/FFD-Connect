import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EntryQrBatch, EntryQrKeySet } from "./entryQr";

/**
 * Persistance locale du QR d'entrée tournant (#24, ADR-0024).
 *
 * - Lot de jetons du licencié : lié au compte qui l'a reçu (même règle que le
 *   snapshot de l'E-Licence, #416) — un appareil partagé ne montre jamais le
 *   QR de A à B. ~130 Ko : trop gros pour SecureStore (limite ~2 Ko), d'où
 *   AsyncStorage, comme le snapshot qui contient déjà le QR statique, valable
 *   lui toute la saison. Un jeton du lot ne vaut que 90 s autour de son pas.
 * - Clés publiques des scanners : publiques, non liées au compte.
 *
 * Purgés avec le snapshot (déconnexion, impersonation, refresh expiré).
 */
const BATCH_KEY = "entry_qr_batch_v1";
const KEYS_KEY = "entry_qr_keys_v2";

interface StoredBatch {
  owner: string;
  batch: EntryQrBatch;
}

function normalizeOwner(owner: string | null | undefined): string | null {
  const normalized = owner?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function isBatch(value: unknown): value is EntryQrBatch {
  if (typeof value !== "object" || value === null) return false;
  const batch = value as Partial<EntryQrBatch>;
  return (
    typeof batch.keyId === "string" &&
    typeof batch.licenseId === "string" &&
    typeof batch.number === "string" &&
    typeof batch.holderName === "string" &&
    typeof batch.stepSeconds === "number" &&
    typeof batch.firstStep === "number" &&
    typeof batch.coversUntil === "string" &&
    Array.isArray(batch.signatures)
  );
}

export async function saveEntryQrBatch(
  owner: string | null | undefined,
  batch: EntryQrBatch,
): Promise<void> {
  const normalizedOwner = normalizeOwner(owner);
  if (!normalizedOwner) return;
  try {
    const stored: StoredBatch = { owner: normalizedOwner, batch };
    await AsyncStorage.setItem(BATCH_KEY, JSON.stringify(stored));
  } catch {
    // Best-effort : le prochain chargement en ligne retentera.
  }
}

/** Lot du compte `owner`, ou null (absent, autre compte, illisible). */
export async function loadEntryQrBatch(
  owner: string | null | undefined,
): Promise<EntryQrBatch | null> {
  const normalizedOwner = normalizeOwner(owner);
  if (!normalizedOwner) return null;
  try {
    const raw = await AsyncStorage.getItem(BATCH_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredBatch> | null;
    if (stored?.owner !== normalizedOwner || !isBatch(stored.batch)) {
      return null;
    }
    return stored.batch;
  } catch {
    return null;
  }
}

export async function clearEntryQrBatch(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BATCH_KEY);
  } catch {
    // Best-effort
  }
}

/**
 * Cached public keys stop being trusted after 7 days (#24): a key removed
 * from the server (compromised, rotated) must not keep validating QRs on a
 * scanner that never went back online.
 */
export const ENTRY_QR_KEYS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

interface StoredKeys {
  fetchedAt: number;
  keySet: EntryQrKeySet;
}

export async function saveEntryQrKeys(
  keySet: EntryQrKeySet,
  now: Date = new Date(),
): Promise<void> {
  try {
    const stored: StoredKeys = { fetchedAt: now.getTime(), keySet };
    await AsyncStorage.setItem(KEYS_KEY, JSON.stringify(stored));
  } catch {
    // Best-effort
  }
}

/** Cached keys, or null when absent, malformed or older than 7 days. */
export async function loadEntryQrKeys(
  now: Date = new Date(),
): Promise<EntryQrKeySet | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredKeys> | null;
    const keySet = stored?.keySet;
    if (
      typeof stored?.fetchedAt !== "number" ||
      now.getTime() - stored.fetchedAt > ENTRY_QR_KEYS_MAX_AGE_MS ||
      !keySet ||
      !Array.isArray(keySet.keys) ||
      typeof keySet.stepSeconds !== "number" ||
      typeof keySet.toleranceSteps !== "number"
    ) {
      return null;
    }
    return keySet;
  } catch {
    return null;
  }
}
