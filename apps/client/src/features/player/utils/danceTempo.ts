// Dance-aware BPM → MPM conversion used for the live preview in the add/edit
// track modal. The BACKEND (apps/backend/src/tracks/bpm.service.ts) is the
// source of truth and recomputes MPM on save — this is a mirror so the modal
// can show the MPM live as the user picks a dance. Keep the two in sync.

export interface DanceGroup {
  label: string;
  dances: string[];
}

// FFD/WDSF International style: the style "categories" are the competition
// dances themselves, grouped Standard / Latin.
export const DANCE_GROUPS: DanceGroup[] = [
  {
    label: "Standard",
    dances: [
      "Valse Lente",
      "Tango",
      "Valse Viennoise",
      "Quickstep",
      "Slow Fox",
    ],
  },
  {
    label: "Latin",
    dances: ["Samba", "Cha-cha", "Rumba", "Paso Doble", "Jive"],
  },
];

interface DanceTempo {
  bpmRange: [number, number];
  beatsPerMeasure: number;
}

const DANCE_TEMPOS: Record<DanceKey, DanceTempo> = {
  rumba: { bpmRange: [95, 115], beatsPerMeasure: 4 },
  "cha-cha": { bpmRange: [115, 140], beatsPerMeasure: 4 },
  samba: { bpmRange: [90, 115], beatsPerMeasure: 2 },
  "paso doble": { bpmRange: [110, 130], beatsPerMeasure: 2 },
  jive: { bpmRange: [158, 186], beatsPerMeasure: 4 },
  "valse lente": { bpmRange: [78, 98], beatsPerMeasure: 3 },
  tango: { bpmRange: [115, 140], beatsPerMeasure: 4 },
  viennoise: { bpmRange: [168, 190], beatsPerMeasure: 3 },
  "slow fox": { bpmRange: [100, 128], beatsPerMeasure: 4 },
  quickstep: { bpmRange: [188, 220], beatsPerMeasure: 4 },
};

/** Canonical dance key (same keys as the backend's STYLE_CONFIG). */
export type DanceKey =
  | "rumba"
  | "cha-cha"
  | "samba"
  | "paso doble"
  | "jive"
  | "valse lente"
  | "tango"
  | "viennoise"
  | "slow fox"
  | "quickstep";

/**
 * The single list of dance recognition patterns of the app (player, library,
 * competition mode), most specific first: the first match wins. Same patterns,
 * same order as the backend's normalizeStyle — pinned by the shared fixture
 * apps/backend/test/fixtures/dance-style-cases.json (#338).
 */
const DANCE_STYLE_PATTERNS: ReadonlyArray<readonly [DanceKey, RegExp]> = [
  ["cha-cha", /cha[\s-]*cha/],
  ["paso doble", /paso/],
  ["samba", /samba/],
  ["jive", /jive/],
  ["rumba", /rumba/],
  ["quickstep", /quick\s*-?\s*step/],
  ["slow fox", /slow\s*-?\s*fox|foxtrot|^fox$/],
  ["viennoise", /vienn|valse\s*rapide/],
  [
    "valse lente",
    /valse\s*lente|valse\s*anglaise|slow\s*waltz|^waltz$|^valse$/,
  ],
  ["tango", /tango/],
];

/** Canonical dance of a track `style`, or null when the dance is unknown. */
export function normalizeDance(input?: string | null): DanceKey | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  for (const [key, pattern] of DANCE_STYLE_PATTERNS) {
    if (pattern.test(s)) return key;
  }
  return null;
}

function normalizeToRange(bpm: number, [min, max]: [number, number]): number {
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
 * Convert a raw detected BPM to dance-aware MPM (mesures par minute).
 * Returns 0 (unknown MPM) when the dance is unknown: a raw BPM must never be
 * shown as an MPM (#338). Mirror of the backend BpmService.calculateMpm.
 */
export function mpmFromBpm(rawBpm: number, dance?: string | null): number {
  if (!rawBpm || rawBpm <= 0) return 0;
  const key = normalizeDance(dance);
  if (key == null) return 0;
  const cfg = DANCE_TEMPOS[key];
  return Math.round(
    normalizeToRange(rawBpm, cfg.bpmRange) / cfg.beatsPerMeasure,
  );
}
