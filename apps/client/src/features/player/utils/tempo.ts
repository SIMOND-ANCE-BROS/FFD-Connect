// Tempo (MPM) helpers shared by the player logic: one source of truth for a
// track's base MPM, its allowed slider range, and the per-style lock key, so
// the displayed MPM, the slider bounds and the playback rate always agree.

/** Base MPM used when a track has no usable tempo metadata. */
export const DEFAULT_BASE_MPM = 30;

/** The slider (and any locked tempo) is limited to ±50% of the base MPM. */
export const MPM_RANGE_RATIO = 0.5;

export const resolveBaseMpm = (baseBpm?: number | null): number =>
  baseBpm && baseBpm > 0 ? Math.round(baseBpm) : DEFAULT_BASE_MPM;

export const mpmRange = (baseMpm: number): { min: number; max: number } => ({
  min: baseMpm * (1 - MPM_RANGE_RATIO),
  max: baseMpm * (1 + MPM_RANGE_RATIO),
});

export const clampMpm = (mpm: number, baseMpm: number): number => {
  const { min, max } = mpmRange(baseMpm);
  return Math.min(max, Math.max(min, mpm));
};

/**
 * Key under which a tempo lock is stored. Dance styles have very different
 * MPM ranges (Rumba ~25, Paso Doble ~60): a lock is kept per style so a
 * Rumba lock never drags a Paso track to the bottom of its range.
 */
export const tempoStyleKey = (style?: string | null): string =>
  style?.trim().toLowerCase() ?? "";
