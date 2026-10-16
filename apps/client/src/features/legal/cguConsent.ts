import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Consentement aux CGU (#424) — persisté par VERSION : incrémenter
 * CGU_VERSION lors d'un changement substantiel des conditions re-déclenche
 * la demande d'acceptation au prochain lancement.
 */
// v2 (#270) : vérification du certificat médical par une personne (CGU §5).
// v3 (#61) : comptes de mineurs ouverts avec l'accord d'un représentant légal
// (CGU §6). Doit rester égale à PARENTAL_CONSENT_CGU_VERSION côté backend.
export const CGU_VERSION = "3";

const STORAGE_KEY = "cgu_accepted_version";

/** L'utilisateur a-t-il accepté la version courante des CGU ? */
export async function hasAcceptedCgu(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === CGU_VERSION;
  } catch {
    // Stockage illisible : ne pas bloquer l'app, on redemandera plus tard.
    return true;
  }
}

/** Enregistre l'acceptation de la version courante des CGU. */
export async function acceptCgu(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, CGU_VERSION);
  } catch {
    // Best-effort : au pire la modale réapparaîtra au prochain lancement.
  }
}
