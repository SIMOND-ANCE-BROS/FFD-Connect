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

const DANCE_TEMPOS: Record<string, DanceTempo> = {
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

function normalizeDance(
  input?: string | null,
): keyof typeof DANCE_TEMPOS | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (/cha[\s-]?cha|chacha/.test(s)) return "cha-cha";
  if (/paso/.test(s)) return "paso doble";
  if (/samba/.test(s)) return "samba";
  if (/jive/.test(s)) return "jive";
  if (/rumba/.test(s)) return "rumba";
  if (/quick\s?step/.test(s)) return "quickstep";
  if (/slow ?fox|foxtrot|^fox$/.test(s)) return "slow fox";
  if (/vienn|valse rapide/.test(s)) return "viennoise";
  if (/slow ?waltz|valse lente|^waltz$|^valse$/.test(s)) return "valse lente";
  if (/tango/.test(s)) return "tango";
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
 * Falls back to the rounded raw BPM when the dance is unknown.
 * Mirror of the backend BpmService.calculateMpm.
 */
export function mpmFromBpm(rawBpm: number, dance?: string | null): number {
  if (!rawBpm || rawBpm <= 0) return 0;
  const key = normalizeDance(dance);
  if (key == null) return Math.round(rawBpm);
  const cfg = DANCE_TEMPOS[key];
  return Math.round(
    normalizeToRange(rawBpm, cfg.bpmRange) / cfg.beatsPerMeasure,
  );
}
