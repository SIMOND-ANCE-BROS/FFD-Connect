/**
 * Import of a TopTurnier export (#786): client-side size check and the event
 * mapping returned by the API (in the report, or in the body of a refusal).
 */

/** Same bound as the API (`TOPTURNIER_MAX_ARCHIVE_BYTES`). */
export const MAX_TOPTURNIER_ARCHIVE_BYTES = 10 * 1024 * 1024;

export const ARCHIVE_TOO_BIG_MESSAGE =
  'Archive trop volumineuse : 10 Mo au plus. Envoyez l’export en plusieurs archives (une partie des dossiers d’épreuve à chaque fois).';

/** Error message of an archive the API would refuse for its size, null when it fits. */
export function archiveSizeError(file: { size: number }): string | null {
  return file.size > MAX_TOPTURNIER_ARCHIVE_BYTES ? ARCHIVE_TOO_BIG_MESSAGE : null;
}

export type TopTurnierEventStatus =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'NO_RESULTS'
  | 'INVALID';

export interface TopTurnierEventMapping {
  folder: string;
  label: string;
  status: TopTurnierEventStatus;
  eventId: string | null;
  eventName: string | null;
  exact: boolean | null;
  rows: number;
  message: string | null;
}

export const STATUS_BADGES: Record<TopTurnierEventStatus, { label: string; color: string }> = {
  MATCHED: { label: 'Importée', color: 'green' },
  UNMATCHED: { label: 'Non reconnue', color: 'gray' },
  AMBIGUOUS: { label: 'Ambiguë', color: 'orange' },
  CONFLICT: { label: 'En conflit', color: 'orange' },
  NO_RESULTS: { label: 'Sans classement', color: 'gray' },
  INVALID: { label: 'Illisible', color: 'red' },
};

const STATUSES = new Set(Object.keys(STATUS_BADGES));

function isMapping(value: unknown): value is TopTurnierEventMapping {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.folder === 'string' &&
    typeof v.label === 'string' &&
    typeof v.status === 'string' &&
    STATUSES.has(v.status) &&
    typeof v.rows === 'number'
  );
}

/** Event mapping of a report or of a refusal body (`events`), else []. */
export function eventMappings(body: unknown): TopTurnierEventMapping[] {
  if (typeof body !== 'object' || body === null) return [];
  const { events } = body as { events?: unknown };
  return Array.isArray(events) ? events.filter(isMapping) : [];
}

/** « 3 épreuves importées sur 7 » */
export function mappingSummary(events: readonly TopTurnierEventMapping[]): string {
  const matched = events.filter((e) => e.status === 'MATCHED').length;
  return `${matched} épreuve${matched > 1 ? 's' : ''} importée${
    matched > 1 ? 's' : ''
  } sur ${events.length}`;
}
