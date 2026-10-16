import dayjs from 'dayjs';
import type { ProgramEventDto } from '../api/generated/types.gen';
import { formatDiscipline } from './discipline';

/**
 * A competition as the back-office lists it. The OpenAPI schema of
 * `GET /competitions` (and `/competitions/:id`) is stale — it documents
 * `name`/`startDate`, the API answers `title`/`date` — so the payload is read
 * field by field instead of trusting the generated type.
 */
export interface CompetitionSummary {
  id: string;
  title: string;
  date: string | null;
  endDate: string | null;
  place: string | null;
  status: string | null;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

export function toCompetitionSummary(raw: unknown): CompetitionSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const city = str(r.city);
  const location = str(r.location);
  return {
    id,
    title: str(r.title) ?? str(r.name) ?? 'Compétition sans titre',
    date: str(r.date) ?? str(r.startDate),
    endDate: str(r.endDate),
    place: [location, city].filter((p) => p !== null).join(', ') || null,
    status: str(r.status),
  };
}

export const COMPETITION_STATUS_BADGES: Record<string, { label: string; color: string }> = {
  UPCOMING: { label: 'À venir', color: 'blue' },
  LIVE: { label: 'En cours', color: 'green' },
  PAST: { label: 'Terminée', color: 'gray' },
  CANCELLED: { label: 'Annulée', color: 'red' },
};

/** « 12/10/2026 », or « 12/10/2026 → 13/10/2026 » over several days; « — » when unknown. */
export function competitionDates(c: Pick<CompetitionSummary, 'date' | 'endDate'>): string {
  if (!c.date) return '—';
  const start = dayjs(c.date).format('DD/MM/YYYY');
  const end = c.endDate ? dayjs(c.endDate).format('DD/MM/YYYY') : start;
  return end === start ? start : `${start} → ${end}`;
}

/**
 * Name of an event, as the CSV `epreuve` column accepts it: speciality, age
 * group and, for a classifying event, level (« Latines Adultes Avancé »).
 */
export function eventLabel(
  event: Pick<ProgramEventDto, 'category' | 'ageGroup' | 'level'>,
): string {
  return [formatDiscipline(event.category), event.ageGroup, event.level]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}
