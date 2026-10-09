import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LicenseUser } from "../components/LicenseCard";

/**
 * Snapshot local de l'E-Licence (#416 — exigence « Jour J » : la licence et
 * son QR doivent rester consultables sans réseau dans un gymnase).
 *
 * Sauvé à chaque chargement réussi du profil ; relu quand le réseau manque.
 * La validité affichée hors-ligne est recalculée localement depuis
 * `validUntilRaw` (voir computeLicenseExpiry), pas depuis le serveur.
 *
 * Owner binding: the snapshot records the account it belongs to (the session's
 * `username`) and is only ever served back to that same account. A snapshot of
 * another account — or a legacy one written before the owner existed — is
 * treated as absent, so a device shared between dancers never shows A's
 * license (and signed QR) to B.
 */

const STORAGE_KEY = "license_snapshot_v1";

export interface LicenseSnapshot {
  /** Account the snapshot belongs to (normalized session `username`). */
  owner: string;
  /** ISO — date de la dernière synchro réussie avec le serveur. */
  savedAt: string;
  ffdUser: LicenseUser;
  wdsfUser: LicenseUser | null;
}

/** Case/whitespace-insensitive account identity; null when unusable. */
function normalizeOwner(owner: string | null | undefined): string | null {
  const normalized = owner?.trim().toLowerCase();
  // Empty after trim = no identity (`??` would keep "").
  if (!normalized) return null;
  return normalized;
}

export async function saveLicenseSnapshot(
  owner: string | null | undefined,
  ffdUser: LicenseUser,
  wdsfUser: LicenseUser | null,
): Promise<void> {
  const normalizedOwner = normalizeOwner(owner);
  // No identity, no snapshot: it could never be served back safely.
  if (!normalizedOwner) return;
  try {
    const snapshot: LicenseSnapshot = {
      owner: normalizedOwner,
      savedAt: new Date().toISOString(),
      ffdUser,
      wdsfUser,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — le prochain chargement réussi retentera.
  }
}

/**
 * Returns the snapshot only when it belongs to `owner`. Another account's
 * snapshot, or a legacy one without owner, reads as `null`.
 */
export async function loadLicenseSnapshot(
  owner: string | null | undefined,
): Promise<LicenseSnapshot | null> {
  const normalizedOwner = normalizeOwner(owner);
  if (!normalizedOwner) return null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<LicenseSnapshot> | null;
    if (
      !snapshot ||
      typeof snapshot.owner !== "string" ||
      snapshot.owner !== normalizedOwner
    ) {
      return null;
    }
    return snapshot as LicenseSnapshot;
  } catch {
    return null;
  }
}

/**
 * À la déconnexion / suppression de compte, aux bascules d'impersonation et à
 * l'expiration du refresh token : ne pas laisser de PII locale.
 */
export async function clearLicenseSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort
  }
}
