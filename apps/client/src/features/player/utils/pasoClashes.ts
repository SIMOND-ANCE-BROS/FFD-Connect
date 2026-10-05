/**
 * Appels/coups (« clashs ») du paso doble (#paso-clashes).
 *
 * Un paso doble de compétition (España Cañí) comporte 2 ou 3 temps forts où les
 * danseurs posent. On affiche leurs timecodes sur le lecteur. Source de vérité :
 * les valeurs éditées par un admin (`Track.clashTimecodes`). À défaut, on estime
 * une position de départ depuis la durée du morceau + la structure standard —
 * l'admin corrige ensuite dans l'éditeur.
 */

/** Nombre d'appels par défaut (España Cañí competition = 3). */
export const DEFAULT_CLASH_COUNT = 3;

/** Vrai si le style de la piste est un paso doble. */
export function isPasoDoble(style: string | null | undefined): boolean {
  return !!style && style.toLowerCase().includes("paso");
}

/**
 * Estimation des appels quand aucune valeur n'a été saisie par un admin.
 * Répartis régulièrement sur la partie dansée, le dernier sur l'accord final.
 * `durationSec` = durée réelle du morceau (connue au moment de la lecture).
 */
export function computeDefaultPasoClashes(
  durationSec: number,
  count: number = DEFAULT_CLASH_COUNT,
): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || count <= 0) {
    return [];
  }
  return Array.from(
    { length: count },
    (_, i) => Math.round(((durationSec * (i + 1)) / count) * 10) / 10,
  );
}

/**
 * Appels effectifs à afficher pour une piste : les valeurs admin si présentes,
 * sinon l'estimation par défaut (uniquement pour un paso doble). Toujours triés.
 */
export function getEffectiveClashes(
  style: string | null | undefined,
  storedClashes: number[] | null | undefined,
  durationSec: number,
): number[] {
  if (!isPasoDoble(style)) return [];
  const source =
    storedClashes && storedClashes.length > 0
      ? storedClashes
      : computeDefaultPasoClashes(durationSec);
  return [...source].sort((a, b) => a - b);
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
