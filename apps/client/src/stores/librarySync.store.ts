import { create } from "zustand";

/**
 * Fraîcheur de la bibliothèque musicale (#beta : « clash validé, bibliothèque
 * inchangée »).
 *
 * La bibliothèque (LibraryContext) est chargée une fois, à la première
 * ouverture de l'onglet, puis gardée en mémoire : elle n'est pas dans React
 * Query, donc aucune invalidation ne l'atteint. Ce store sert de signal :
 * - une action qui modifie une piste (validation d'une proposition, édition
 *   admin des clashs) appelle `markStale()` → la bibliothèque déjà chargée se
 *   recharge en arrière-plan ;
 * - au retour sur l'onglet, une bibliothèque plus vieille que
 *   LIBRARY_MAX_AGE_MS est rechargée (corrections validées par un autre
 *   administrateur).
 *
 * Pas de polling : un rechargement n'a lieu que sur une action ou un retour
 * sur l'onglet, quand l'app est de toute façon en cours d'utilisation.
 */

/** Âge au-delà duquel la bibliothèque est rechargée au retour sur l'onglet. */
export const LIBRARY_MAX_AGE_MS = 10 * 60 * 1000;

interface LibrarySyncState {
  /** Incrémenté à chaque modification connue d'une piste. */
  version: number;
  /** `version` au début du dernier chargement réussi. */
  loadedVersion: number;
  /** Horodatage (ms) du dernier chargement réussi ; 0 = jamais chargée. */
  loadedAt: number;
  /** Une piste a changé côté serveur : la bibliothèque en mémoire est périmée. */
  markStale: () => void;
  /** Chargement réussi, commencé alors que le store était en `version`. */
  markLoaded: (version: number, at?: number) => void;
}

export const useLibrarySyncStore = create<LibrarySyncState>((set) => ({
  version: 0,
  loadedVersion: 0,
  loadedAt: 0,
  markStale: () => set((s) => ({ version: s.version + 1 })),
  markLoaded: (version, at = Date.now()) =>
    set((s) => ({
      loadedVersion: Math.max(s.loadedVersion, version),
      loadedAt: at,
    })),
}));

/** Signale qu'une piste a changé (utilisable hors composant). */
export const markLibraryStale = (): void => {
  useLibrarySyncStore.getState().markStale();
};

/**
 * Vrai si une bibliothèque DÉJÀ chargée doit être rechargée : une piste a
 * changé depuis, ou le chargement date de plus de LIBRARY_MAX_AGE_MS.
 * Jamais chargée → false (le premier chargement a sa propre règle).
 */
export function isLibraryStale(
  state: Pick<LibrarySyncState, "version" | "loadedVersion" | "loadedAt">,
  now: number,
): boolean {
  if (state.loadedAt === 0) return false;
  return (
    state.version > state.loadedVersion ||
    now - state.loadedAt > LIBRARY_MAX_AGE_MS
  );
}
