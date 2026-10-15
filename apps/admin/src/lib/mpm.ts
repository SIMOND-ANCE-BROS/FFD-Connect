/**
 * Mirror of the backend tempo rules, for the live MPM preview of the track
 * page and the import table: BpmService.calculateMpm and
 * TracksService.bpmForPatch (apps/backend/src/tracks). The backend stays the
 * source of truth and recomputes on save; both implementations are pinned by
 * the shared fixture apps/backend/test/fixtures/mpm-cases.json.
 */
interface DanceTempo {
  bpmRange: [number, number];
  beatsPerMeasure: number;
}

const DANCE_TEMPOS = {
  rumba: { bpmRange: [95, 115], beatsPerMeasure: 4 },
  'cha-cha': { bpmRange: [115, 140], beatsPerMeasure: 4 },
  samba: { bpmRange: [90, 115], beatsPerMeasure: 2 },
  'paso doble': { bpmRange: [110, 130], beatsPerMeasure: 2 },
  jive: { bpmRange: [158, 186], beatsPerMeasure: 4 },
  'valse lente': { bpmRange: [78, 98], beatsPerMeasure: 3 },
  tango: { bpmRange: [115, 140], beatsPerMeasure: 4 },
  viennoise: { bpmRange: [168, 190], beatsPerMeasure: 3 },
  'slow fox': { bpmRange: [100, 128], beatsPerMeasure: 4 },
  quickstep: { bpmRange: [188, 220], beatsPerMeasure: 4 },
} satisfies Record<string, DanceTempo>;

export type DanceKey = keyof typeof DANCE_TEMPOS;

/**
 * Same patterns, same order as the backend's normalizeStyle (first match
 * wins); pinned by apps/backend/test/fixtures/dance-style-cases.json.
 */
const DANCE_STYLE_PATTERNS: ReadonlyArray<readonly [DanceKey, RegExp]> = [
  ['cha-cha', /cha[\s-]*cha/],
  ['paso doble', /paso/],
  ['samba', /samba/],
  ['jive', /jive/],
  ['rumba', /rumba/],
  ['quickstep', /quick\s*-?\s*step/],
  ['slow fox', /slow\s*-?\s*fox|foxtrot|^fox$/],
  ['viennoise', /vienn|valse\s*rapide/],
  ['valse lente', /valse\s*lente|valse\s*anglaise|slow\s*waltz|^waltz$|^valse$/],
  ['tango', /tango/],
];

export function normalizeDance(input?: string | null): DanceKey | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  for (const [key, pattern] of DANCE_STYLE_PATTERNS) {
    if (pattern.test(s)) return key;
  }
  return null;
}

/** The octave-shifted candidate closest to the centre of the dance's range. */
function normalizeToRange(bpm: number, [min, max]: [number, number]): number {
  if (bpm <= 0) return 0;
  const center = (min + max) / 2;
  let best = bpm;
  let bestDist = Math.abs(bpm - center);
  for (const candidate of [bpm, bpm * 2, bpm / 2, bpm * 4, bpm / 4]) {
    const dist = Math.abs(candidate - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** Raw BPM → MPM for the dance; 0 (unknown MPM) when the dance is unknown. */
export function calculateMpm(rawBpm: number, style?: string | null): number {
  if (rawBpm <= 0) return 0;
  const key = normalizeDance(style);
  if (key === null) return 0;
  const tempo: DanceTempo = DANCE_TEMPOS[key];
  return Math.round(normalizeToRange(rawBpm, tempo.bpmRange) / tempo.beatsPerMeasure);
}

/** Hand-entered tempo → MPM: a BPM typed as an MPM (in the dance's BPM range) is converted. */
export function toMpm(tempo: number, style?: string | null): number {
  const key = normalizeDance(style);
  if (key === null) return tempo;
  const { bpmRange, beatsPerMeasure }: DanceTempo = DANCE_TEMPOS[key];
  if (tempo < bpmRange[0] || tempo > bpmRange[1]) return tempo;
  return Math.round(tempo / beatsPerMeasure);
}

/** MPM a PATCH will write, or undefined when it leaves the MPM as it is. */
export function bpmForPatch(
  rawBpm: number,
  patch: { bpm?: number; style?: string },
  currentStyle?: string | null,
): number | undefined {
  if (patch.bpm !== undefined) return toMpm(patch.bpm, patch.style ?? currentStyle);
  if (patch.style && rawBpm > 0) return calculateMpm(rawBpm, patch.style);
  return undefined;
}
