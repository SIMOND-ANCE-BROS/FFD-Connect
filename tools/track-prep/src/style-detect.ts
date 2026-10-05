/**
 * Détection automatique de la danse, en cascade :
 *  1. texte (nom de playlist, titre du morceau) — les playlists dansesport
 *     mentionnent très souvent la danse ;
 *  2. tempo brut — chaque danse a une plage BPM de compétition, mais
 *     plusieurs plages se recouvrent (Samba ↔ Rumba, Cha-cha ↔ Tango,
 *     Jive ↔ Valse Viennoise) : quand plusieurs danses restent plausibles,
 *     on N'ASSIGNE RIEN et on retourne la liste des candidates pour que
 *     l'utilisateur tranche (via le manifeste).
 */
import { calculateMpm, canonicalStyleLabel, STYLE_CONFIG } from './mpm.js';

/** Danse détectée dans un texte (nom de playlist, titre…), sinon null. */
export function detectStyleFromTitle(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    const label = canonicalStyleLabel(text);
    if (label) return label;
  }
  return null;
}

export interface StyleCandidate {
  label: string;
  /** MPM qu'aurait le morceau si cette danse était retenue. */
  mpm: number;
  /** Plausibilité relative (0..1) — sert uniquement à ordonner/départager. */
  score: number;
}

export interface TempoDetection {
  /** Danse retenue si une seule candidate se détache nettement, sinon null. */
  best: string | null;
  /** Danses plausibles pour ce tempo, de la plus à la moins probable. */
  candidates: StyleCandidate[];
}

/**
 * Un tempo sans décalage d'octave est bien plus fiable qu'un tempo ×2/÷2
 * (music-tempo se trompe parfois d'octave, mais pas systématiquement).
 */
const OCTAVE_FACTORS = [
  { factor: 1, weight: 1 },
  { factor: 2, weight: 0.55 },
  { factor: 0.5, weight: 0.55 },
  { factor: 4, weight: 0.25 },
  { factor: 0.25, weight: 0.25 },
];

/** Écart de score minimal pour trancher entre deux danses plausibles. */
const MIN_GAP = 0.3;

/**
 * Danses plausibles pour un BPM brut. `best` n'est renseigné que si la
 * première candidate domine nettement (plages sans recouvrement au tempo
 * détecté) — sinon l'appelant présente `candidates` à l'utilisateur.
 */
export function detectStyleFromTempo(rawBpm: number): TempoDetection {
  if (rawBpm <= 0) return { best: null, candidates: [] };

  const candidates: StyleCandidate[] = [];
  for (const [key, config] of Object.entries(STYLE_CONFIG)) {
    const [min, max] = config.bpmRange;
    const center = (min + max) / 2;
    const halfWidth = (max - min) / 2;
    let bestScore = 0;
    for (const { factor, weight } of OCTAVE_FACTORS) {
      const shifted = rawBpm * factor;
      if (shifted < min || shifted > max) continue;
      const proximity = 1 - Math.abs(shifted - center) / halfWidth;
      bestScore = Math.max(bestScore, weight * (0.4 + 0.6 * proximity));
    }
    if (bestScore > 0) {
      const label = canonicalStyleLabel(key);
      if (label) {
        candidates.push({
          label,
          mpm: calculateMpm(rawBpm, key),
          score: Math.round(bestScore * 1000) / 1000,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const decisive =
    candidates.length === 1 ||
    (candidates.length > 1 && candidates[0].score - candidates[1].score >= MIN_GAP);
  return { best: decisive && candidates.length > 0 ? candidates[0].label : null, candidates };
}
