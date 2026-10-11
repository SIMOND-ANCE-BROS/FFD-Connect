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

/** Same patterns, same order as the backend's normalizeStyle. */
export function normalizeDance(input?: string | null): DanceKey | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
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

/** Raw BPM → MPM for the dance; the rounded raw BPM when the dance is unknown. */
export function calculateMpm(rawBpm: number, style?: string | null): number {
  if (rawBpm === 0) return 0;
  const key = normalizeDance(style);
  if (key === null) return Math.round(rawBpm);
  const tempo: DanceTempo = DANCE_TEMPOS[key];
  return Math.round(normalizeToRange(rawBpm, tempo.bpmRange) / tempo.beatsPerMeasure);
}

/** MPM a PATCH will write, or undefined when it leaves the MPM as it is. */
export function bpmForPatch(
  rawBpm: number,
  patch: { bpm?: number; style?: string },
): number | undefined {
  if (patch.bpm !== undefined) return patch.bpm;
  if (patch.style && rawBpm > 0) {
    const mpm = calculateMpm(rawBpm, patch.style);
    if (mpm > 0) return mpm;
  }
  return undefined;
}
