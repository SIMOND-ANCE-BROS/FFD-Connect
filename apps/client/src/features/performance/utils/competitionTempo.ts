/**
 * Regulation tempo of the competition dances (WDSF tempos, reused by the FFD).
 * In competition mode a dance only draws tracks whose ORIGINAL tempo is in its
 * range: the playback speed is never changed. Single source of truth — fix a
 * range here and the draw and the setup message follow.
 */
import type { TrackData } from "../../player/context/PlayerContext";

/** Tempo range in MPM (mesures par minute), bounds included. */
export interface TempoRange {
  min: number;
  max: number;
}

/** Keyed by the canonical dance ids of DANCES (performance.store). */
export const COMPETITION_TEMPO: Readonly<Record<string, TempoRange>> = {
  "Valse Lente": { min: 28, max: 30 },
  Tango: { min: 31, max: 33 },
  "Valse Viennoise": { min: 58, max: 60 },
  "Slow Fox": { min: 28, max: 30 },
  Quickstep: { min: 50, max: 52 },
  Samba: { min: 50, max: 52 },
  "Cha-Cha-Cha": { min: 30, max: 32 },
  Rumba: { min: 24, max: 26 },
  "Paso Doble": { min: 60, max: 62 },
  Jive: { min: 42, max: 44 },
};

export const tempoRange = (dance: string): TempoRange | null =>
  COMPETITION_TEMPO[dance] ?? null;

/**
 * True when the track's original MPM (`baseBpm`, already dance-aware) is in the
 * dance's range. A track without a usable tempo is off-range; a dance without
 * a range never blocks (guarded by a test: every DANCES id has one).
 */
export const isTempoCompliant = (
  track: Pick<TrackData, "baseBpm">,
  dance: string,
): boolean => {
  const range = tempoRange(dance);
  if (!range) return true;
  const mpm = track.baseBpm;
  if (typeof mpm !== "number" || !Number.isFinite(mpm) || mpm <= 0) {
    return false;
  }
  const rounded = Math.round(mpm);
  return rounded >= range.min && rounded <= range.max;
};
