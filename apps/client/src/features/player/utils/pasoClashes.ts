/**
 * Appels/coups (« clashs ») du paso doble (#paso-clashes).
 *
 * Selon la coupe, une musique de paso doble de compétition (España Cañí)
 * comporte 2 ou 3 clashs, jamais plus (PASO_MAX_CLASHES). On affiche leurs
 * timecodes sur le lecteur. Source de vérité : les valeurs éditées par un
 * admin (`Track.clashTimecodes`). À défaut, on estime une position de départ
 * depuis le tempo (phrases musicales) — l'admin corrige ensuite dans l'éditeur.
 */

/**
 * Nombre maximal de clashs d'un paso doble. Même borne que le backend
 * (`PASO_MAX_CLASHES`, DTO de PATCH /tracks/:id et des propositions).
 */
export const PASO_MAX_CLASHES = 3;

/** Nombre d'appels estimés par défaut (lecteur, éditeur). */
export const DEFAULT_CLASH_COUNT = 3;

/**
 * Tempo de référence d'un paso doble (MPM, mesures 2/4 par minute) quand la
 * piste n'en a pas d'exploitable. Plage de compétition : 60-62 MPM.
 */
export const PASO_DEFAULT_MPM = 60;

/** Bornes de plausibilité d'un tempo paso doble en MPM. */
const PASO_MPM_MIN = 45;
const PASO_MPM_MAX = 90;

/** Une phrase musicale = 8 mesures (16 temps, soit deux « 8 temps »). */
export const BARS_PER_PHRASE = 8;

/**
 * Structure standard d'España Cañí en compétition : un clash toutes les
 * 5 phrases de 8 mesures (40 mesures). À 60 MPM : 0:40, 1:20 puis 2:00 — ce
 * qui correspond aux 80 s / 120 s du mode compétition « 2 / 3 clashs ».
 */
export const PHRASES_PER_CLASH = 5;

/** Vrai si le style de la piste est un paso doble. */
export function isPasoDoble(style: string | null | undefined): boolean {
  return !!style && style.toLowerCase().includes("paso");
}

/**
 * Tempo exploitable en MPM. Un BPM brut (≈ 120, deux temps par mesure) est
 * ramené en MPM ; une valeur absente ou aberrante retombe sur 60 MPM.
 */
export function normalizePasoMpm(tempo: number | null | undefined): number {
  if (tempo === null || tempo === undefined || !Number.isFinite(tempo)) {
    return PASO_DEFAULT_MPM;
  }
  const mpm = tempo > PASO_MPM_MAX ? tempo / 2 : tempo;
  return mpm >= PASO_MPM_MIN && mpm <= PASO_MPM_MAX ? mpm : PASO_DEFAULT_MPM;
}

/**
 * Estimation des appels quand aucune valeur n'a été saisie par un admin.
 *
 * Pas d'analyse audio disponible (ni grille de temps, ni sections) : on
 * s'appuie sur la carrure de la musique. Chaque clash tombe sur une fin de
 * phrase de 8 mesures, toutes les PHRASES_PER_CLASH phrases, calculées depuis
 * le MPM de la piste. Déterministe.
 *
 * `count` = nombre demandé par le contexte (3 par défaut dans le lecteur,
 * réglage « 2 / 3 clashs » en compétition), borné à PASO_MAX_CLASHES. Une
 * piste trop courte pour tous les clashs à intervalle standard est une coupe
 * plus courte : on n'estime que ceux qui y tiennent (une coupe de 80 s à
 * 60 MPM → 2 clashs). Si même un seul n'y tient pas, l'intervalle est réduit
 * (en phrases entières) pour répartir les clashs demandés.
 *
 * `durationSec` = durée réelle du morceau (connue au moment de la lecture),
 * `mpm` = tempo de la piste en mesures par minute.
 */
export function computeDefaultPasoClashes(
  durationSec: number,
  mpm?: number | null,
  count: number = DEFAULT_CLASH_COUNT,
): number[] {
  const requested = Math.min(Math.floor(count), PASO_MAX_CLASHES);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || requested <= 0) {
    return [];
  }
  const phraseSec = (BARS_PER_PHRASE * 60) / normalizePasoMpm(mpm);
  // Tolérance d'arrondi : une piste de 80,0 s à 60 MPM compte 10 phrases.
  const phrasesInTrack = Math.floor(durationSec / phraseSec + 1e-6);
  const fitting = Math.min(
    requested,
    Math.floor(phrasesInTrack / PHRASES_PER_CLASH),
  );
  const n = fitting > 0 ? fitting : requested;
  const phrasesPerClash = Math.min(
    PHRASES_PER_CLASH,
    Math.floor(phrasesInTrack / n),
  );
  if (phrasesPerClash < 1) return [];
  return Array.from(
    { length: n },
    (_, i) => Math.round((i + 1) * phrasesPerClash * phraseSec * 10) / 10,
  );
}

/**
 * Appels effectifs à afficher pour une piste : les valeurs admin si présentes
 * (toutes, au plus PASO_MAX_CLASHES), sinon l'estimation de `count` clashs
 * (uniquement pour un paso doble). Toujours triés.
 */
export function getEffectiveClashes(
  style: string | null | undefined,
  storedClashes: number[] | null | undefined,
  durationSec: number,
  mpm?: number | null,
  count: number = DEFAULT_CLASH_COUNT,
): number[] {
  if (!isPasoDoble(style)) return [];
  if (storedClashes && storedClashes.length > 0) {
    return [...storedClashes].sort((a, b) => a - b).slice(0, PASO_MAX_CLASHES);
  }
  return computeDefaultPasoClashes(durationSec, mpm, count);
}

/**
 * Nombre de clashs renseignés pour une piste paso doble (au plus
 * PASO_MAX_CLASHES), `null` pour une autre danse. 0 = pas encore saisis.
 */
export function storedPasoClashCount(
  style: string | null | undefined,
  storedClashes: number[] | null | undefined,
): number | null {
  if (!isPasoDoble(style)) return null;
  return Math.min(storedClashes?.length ?? 0, PASO_MAX_CLASHES);
}

/**
 * Prochain appel strictement après `positionSec`, ou null si tous sont passés.
 * Retourne aussi son index (1-based) pour l'affichage « appel 2/3 ».
 */
export function nextClash(
  positionSec: number,
  clashes: number[],
): { time: number; index: number; total: number } | null {
  const sorted = [...clashes].sort((a, b) => a - b);
  const i = sorted.findIndex((t) => t > positionSec + 0.05);
  if (i === -1) return null;
  return { time: sorted[i], index: i + 1, total: sorted.length };
}
