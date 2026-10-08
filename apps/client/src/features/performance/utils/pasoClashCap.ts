import type {
  PerformanceConfig,
  PlaylistItem,
} from "../../../stores/performance.store";
import type { TrackData } from "../../player/context/PlayerContext";
import { isPasoDoble } from "../../player/utils/pasoClashes";
import { danceDuration } from "./competitionProgram";

/** Nombre de clashs saisis sur une piste (0 = aucun, estimés). */
const savedClashCount = (track: TrackData): number =>
  track.clashTimecodes?.length ?? 0;

/**
 * Pistes éligibles au tirage d'une compétition, selon le réglage paso doble.
 *
 * - « 3 clashs » : le paso doit pouvoir être dansé jusqu'au 3e clash. Seules
 *   les pistes à 3 clashs saisis sont retenues ; s'il n'y en a aucune, repli
 *   sur les pistes sans clash saisi (estimés, jouées avec 3). Une piste à 2
 *   clashs (coupe courte) n'est JAMAIS tirée.
 * - « 2 clashs » (ou moins) : tout paso convient ; capPasoClashes le coupe au
 *   2e clash.
 *
 * Les autres danses ne sont pas filtrées. Sans paso éligible, la validation
 * du programme signale « Aucune musique disponible » pour le paso doble.
 */
export function selectPasoPool(
  tracks: TrackData[],
  setting: number,
): TrackData[] {
  if (setting < 3) return tracks;
  const isPaso = (t: TrackData) => isPasoDoble(t.style);
  const pasos = tracks.filter(isPaso);
  const withThree = pasos.filter((t) => savedClashCount(t) >= 3);
  const eligible = new Set(
    withThree.length > 0
      ? withThree
      : pasos.filter((t) => savedClashCount(t) === 0),
  );
  return tracks.filter((t) => !isPaso(t) || eligible.has(t));
}

/**
 * Nombre de clashs réellement joués pour un paso doble en mode compétition :
 * le réglage (« 2 » ou « 3 clashs ») plafonné par le nombre de clashs saisis
 * sur la piste (garde-fou : avec « 3 », selectPasoPool écarte déjà les pistes
 * à 2 clashs). Une piste sans clash saisi suit le réglage.
 */
export function effectivePasoClashes(
  setting: number,
  trackClashTimecodes: readonly number[] | undefined,
): number {
  const stored = trackClashTimecodes?.length ?? 0;
  return stored > 0 ? Math.min(setting, stored) : setting;
}

/**
 * Garde-fou : réaligne la durée des paso doble d'une playlist de compétition
 * sur le nombre de clashs effectif (une piste ne joue jamais plus de clashs
 * qu'elle n'en a). Les autres danses sont inchangées. Pure : renvoie une
 * nouvelle liste.
 *
 * En l'état c'est un no-op : selectPasoPool n'admet avec « 3 clashs » que des
 * pistes à 3 clashs saisis (ou sans clash saisi), et avec « 2 clashs » la
 * durée de base est déjà celle de 2 clashs — l'effectif ne diffère donc jamais
 * de la durée calculée. Conservé pour le jour où le tirage s'assouplirait.
 */
export function capPasoClashes(
  items: PlaylistItem[],
  cfg: Pick<PerformanceConfig, "duration" | "pasoClashes">,
): PlaylistItem[] {
  return items.map((item) => {
    if (!item.isPaso) return item;
    const clashes = effectivePasoClashes(
      cfg.pasoClashes,
      item.track.clashTimecodes,
    );
    // danceDuration ne connaît que 2 | 3 : 1 clash garde la durée « 2 clashs »
    // (une liste d'un seul clash est le plus souvent incomplète).
    const duration = danceDuration(item.style, {
      ...cfg,
      pasoClashes: clashes >= 3 ? 3 : 2,
    });
    return duration === item.duration ? item : { ...item, duration };
  });
}
