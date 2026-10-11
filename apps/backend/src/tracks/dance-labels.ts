/**
 * Canonical dance labels stored in Track.style: the dances the mobile track
 * editor offers (apps/client/src/features/player/utils/danceTempo.ts,
 * DANCE_GROUPS, same order) and that track-prep writes in its manifest. Each
 * one is recognised by BpmService.calculateMpm (pinned by mpm-parity.spec.ts).
 */
export const TRACK_DANCE_LABELS = [
  "Valse Lente",
  "Tango",
  "Valse Viennoise",
  "Quickstep",
  "Slow Fox",
  "Samba",
  "Cha-cha",
  "Rumba",
  "Paso Doble",
  "Jive",
] as const;

/** Style (or artist) of the pause music of the competition mode, kept out of the library. */
export const AMBIANCE_STYLE = "Ambiance";

/** Values accepted as `style` by the back-office import. */
export const TRACK_STYLE_OPTIONS = [
  ...TRACK_DANCE_LABELS,
  AMBIANCE_STYLE,
] as const;
export type TrackStyleOption = (typeof TRACK_STYLE_OPTIONS)[number];
