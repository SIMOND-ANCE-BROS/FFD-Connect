/**
 * Tempo compétition FFD / WDSF — conversion BPM (temps/min) → MPM (mesures/min).
 *
 * SOURCE DE VÉRITÉ : apps/backend/src/tracks/bpm.service.ts
 * Miroir client : apps/client/src/features/player/utils/danceTempo.ts
 * Toute modification des plages ou de la normalisation doit être répercutée
 * dans les trois fichiers.
 */

export interface StyleConfig {
  /** Raw BPM range typically reported for this dance in competition tempo. */
  bpmRange: [number, number];
  /** Beats per measure (used to convert BPM → MPM). */
  beatsPerMeasure: number;
}

export const STYLE_CONFIG: Record<string, StyleConfig> = {
  // Danses Latines
  rumba: { bpmRange: [95, 115], beatsPerMeasure: 4 }, // ~100-108 BPM → 25-27 MPM
  'cha-cha': { bpmRange: [115, 140], beatsPerMeasure: 4 }, // ~120-128 → 30-32
  samba: { bpmRange: [90, 115], beatsPerMeasure: 2 }, // ~100-104 → 50-52
  'paso doble': { bpmRange: [110, 130], beatsPerMeasure: 2 }, // ~120-124 → 60-62
  jive: { bpmRange: [158, 186], beatsPerMeasure: 4 }, // ~168-176 → 42-44
  // Danses Standard
  'valse lente': { bpmRange: [78, 98], beatsPerMeasure: 3 }, // ~84-90 → 28-30
  tango: { bpmRange: [115, 140], beatsPerMeasure: 4 }, // ~124-132 → 31-33
  viennoise: { bpmRange: [168, 190], beatsPerMeasure: 3 }, // ~174-180 → 58-60
  'slow fox': { bpmRange: [100, 128], beatsPerMeasure: 4 }, // ~112-120 → 28-30
  quickstep: { bpmRange: [188, 220], beatsPerMeasure: 4 }, // ~200-208 → 50-52
};

/**
 * Libellés canoniques des 10 danses, tels que stockés dans Track.style
 * (et reconnus par BpmService.calculateMpm / danceTempo.ts côté client).
 */
const STYLE_LABELS: Record<keyof typeof STYLE_CONFIG, string> = {
  rumba: 'Rumba',
  'cha-cha': 'Cha-cha',
  samba: 'Samba',
  'paso doble': 'Paso Doble',
  jive: 'Jive',
  'valse lente': 'Valse Lente',
  tango: 'Tango',
  viennoise: 'Valse Viennoise',
  'slow fox': 'Slow Fox',
  quickstep: 'Quickstep',
};

export const DANCE_LABELS: string[] = Object.values(STYLE_LABELS);

/**
 * Map any synonym/uppercase variant the user or filename may provide to one of
 * the 10 canonical ballroom dances handled by `STYLE_CONFIG`. Returns null for
 * federation categories ("LATIN", "STANDARD") or unknown labels — caller
 * falls back to raw BPM.
 */
export function normalizeStyle(input?: string | null): keyof typeof STYLE_CONFIG | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  // Order matters: more specific patterns first.
  if (/cha[\s-]?cha|chacha/.test(s)) return 'cha-cha';
  if (/paso/.test(s)) return 'paso doble';
  if (/samba/.test(s)) return 'samba';
  if (/jive/.test(s)) return 'jive';
  if (/rumba/.test(s)) return 'rumba';
  if (/quick\s?step/.test(s)) return 'quickstep';
  if (/slow ?fox|foxtrot|^fox$/.test(s)) return 'slow fox';
  if (/vienn|valse rapide/.test(s)) return 'viennoise';
  if (/slow ?waltz|valse lente|^waltz$|^valse$/.test(s)) return 'valse lente';
  if (/tango/.test(s)) return 'tango';
  return null;
}

/** Libellé canonique ("Cha-cha", "Valse Lente"…) pour un synonyme quelconque. */
export function canonicalStyleLabel(input?: string | null): string | null {
  const key = normalizeStyle(input);
  return key == null ? null : STYLE_LABELS[key];
}

/**
 * `music-tempo` often reports half or double the real tempo. Pick the octave-
 * shifted candidate (×2, ÷2, ×4, ÷4, or unchanged) whose value sits closest
 * to the center of the dance's expected BPM range.
 */
export function normalizeToRange(bpm: number, [min, max]: [number, number]): number {
  if (bpm <= 0) return 0;
  const center = (min + max) / 2;
  const candidates = [bpm, bpm * 2, bpm / 2, bpm * 4, bpm / 4];
  let best = bpm;
  let bestDist = Math.abs(bpm - center);
  for (const c of candidates) {
    const d = Math.abs(c - center);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Convertit un BPM brut (détecté par `music-tempo`) en MPM (mesures par
 * minute) selon la danse. Corrige les erreurs d'octave (×2, ÷2…) en
 * recalant le BPM dans la plage attendue, puis divise par le nombre de
 * temps par mesure de la danse.
 *
 * Retourne le BPM brut arrondi si le style est inconnu.
 */
export function calculateMpm(rawBpm: number, style?: string | null): number {
  if (rawBpm === 0) return 0;
  const key = normalizeStyle(style);
  if (key == null) {
    return Math.round(rawBpm);
  }
  const config = STYLE_CONFIG[key];
  const normalized = normalizeToRange(rawBpm, config.bpmRange);
  return Math.round(normalized / config.beatsPerMeasure);
}
