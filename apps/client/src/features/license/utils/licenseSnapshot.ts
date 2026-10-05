import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LicenseUser } from "../components/LicenseCard";

/**
 * Snapshot local de l'E-Licence (#416 — exigence « Jour J » : la licence et
 * son QR doivent rester consultables sans réseau dans un gymnase).
 *
 * Sauvé à chaque chargement réussi du profil ; relu quand le réseau manque.
 * La validité affichée hors-ligne est recalculée localement depuis
 * `validUntilRaw` (voir computeLicenseExpiry), pas depuis le serveur.
 */

const STORAGE_KEY = "license_snapshot_v1";

export interface LicenseSnapshot {
  /** ISO — date de la dernière synchro réussie avec le serveur. */
  savedAt: string;
  ffdUser: LicenseUser;
  wdsfUser: LicenseUser | null;
}

export async function saveLicenseSnapshot(
  ffdUser: LicenseUser,
  wdsfUser: LicenseUser | null,
): Promise<void> {
  try {
    const snapshot: LicenseSnapshot = {
      savedAt: new Date().toISOString(),
      ffdUser,
      wdsfUser,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — le prochain chargement réussi retentera.
  }
}

export async function loadLicenseSnapshot(): Promise<LicenseSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseSnapshot;
  } catch {
    return null;
  }
}

/** À la déconnexion / suppression de compte : ne pas laisser de PII locale. */
export async function clearLicenseSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort
  }
}
