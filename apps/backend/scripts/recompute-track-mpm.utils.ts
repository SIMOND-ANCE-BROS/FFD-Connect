/**
 * Core of scripts/recompute-track-mpm.ts (kept separate so it can be
 * unit-tested without a database). See the script header for the run book.
 */
import { normalizeStyle } from "../src/tracks/bpm.service";

export interface TrackTempoRow {
  id: string;
  style: string | null;
  /** Stored MPM (0 = unknown). */
  bpm: number;
  /** Raw BPM detected at import (0 = none). */
  rawBpm: number;
}

/** The tempo rules of BpmService (BpmService satisfies it). */
export interface MpmRules {
  calculateMpm(rawBpm: number, style?: string | null): number;
  toMpm(tempo: number, style?: string | null): number;
}

/** The two Prisma calls the recompute needs. */
export interface TrackTempoStore {
  findPage(cursor: string | undefined, take: number): Promise<TrackTempoRow[]>;
  /** Compare-and-set: rewrites only if the stored MPM is still `previous`. */
  replaceMpm(id: string, previous: number, next: number): Promise<number>;
}

export interface TrackMpmReport {
  scanned: number;
  /** MPM corrected (or, in a dry run, to be corrected). */
  corrected: number;
  /** Of which: unknown dance, raw BPM stored as MPM → MPM cleared (0). */
  cleared: number;
  /** Changed concurrently between the read and the write: left as is. */
  skipped: number;
  /** Ids of the corrected tracks with their old and new MPM. */
  changes: Array<{ id: string; from: number; to: number }>;
}

export const TRACK_MPM_PAGE_SIZE = 200;

/**
 * The MPM a stored track should carry, or null when it is already right.
 *
 * - Known dance: the raw BPM stored as MPM (dance variant the backend did not
 *   recognise, e.g. « valse anglaise ») is converted from the raw BPM; a BPM
 *   typed as an MPM (inside the dance's BPM range) is converted.
 * - Unknown dance: the raw BPM stored as MPM is cleared (0 = unknown MPM).
 *
 * Any other value (an admin's MPM, a correct conversion) is left alone, so a
 * second run changes nothing.
 */
export function plannedMpm(row: TrackTempoRow, rules: MpmRules): number | null {
  const rawStoredAsMpm = row.rawBpm > 0 && row.bpm === Math.round(row.rawBpm);
  let target: number;
  if (normalizeStyle(row.style) !== null) {
    target = rawStoredAsMpm
      ? rules.calculateMpm(row.rawBpm, row.style)
      : rules.toMpm(row.bpm, row.style);
  } else {
    target = rawStoredAsMpm && row.bpm > 0 ? 0 : row.bpm;
  }
  return target !== row.bpm ? target : null;
}

/**
 * Recomputes the MPM of every track whose stored value is a raw BPM (#338).
 * Without `apply` it is a dry run: nothing is written and `corrected` counts
 * what would change.
 */
export async function recomputeTrackMpm(
  store: TrackTempoStore,
  rules: MpmRules,
  {
    apply,
    pageSize = TRACK_MPM_PAGE_SIZE,
  }: { apply: boolean; pageSize?: number },
): Promise<TrackMpmReport> {
  const report: TrackMpmReport = {
    scanned: 0,
    corrected: 0,
    cleared: 0,
    skipped: 0,
    changes: [],
  };
  let cursor: string | undefined;
  for (;;) {
    const page = await store.findPage(cursor, pageSize);
    for (const row of page) {
      report.scanned += 1;
      const next = plannedMpm(row, rules);
      if (next === null) continue;
      if (apply && (await store.replaceMpm(row.id, row.bpm, next)) === 0) {
        report.skipped += 1;
        continue;
      }
      report.corrected += 1;
      if (next === 0) report.cleared += 1;
      report.changes.push({ id: row.id, from: row.bpm, to: next });
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return report;
}
