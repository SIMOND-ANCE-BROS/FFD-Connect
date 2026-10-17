import dayjs from 'dayjs';
import type { CompetitionListItemDto, ProgramEventDto } from '../api/generated/types.gen';
import { formatDiscipline } from './discipline';

/** A competition as the back-office lists it. */
export interface CompetitionSummary {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  place: string | null;
  status: CompetitionListItemDto['status'];
}

/** Fields of `GET /competitions` (and `/competitions/:id`) the back-office shows. */
export type CompetitionFields = Pick<
  CompetitionListItemDto,
  'id' | 'title' | 'date' | 'endDate' | 'location' | 'city' | 'status'
>;

export function toCompetitionSummary(c: CompetitionFields): CompetitionSummary {
  const place = [c.location, c.city].filter((p): p is string => Boolean(p?.trim())).join(', ');
  return {
    id: c.id,
    title: c.title,
    date: c.date,
    endDate: c.endDate,
    place: place || null,
    status: c.status,
  };
}

export const COMPETITION_STATUS_BADGES: Record<string, { label: string; color: string }> = {
  UPCOMING: { label: 'À venir', color: 'blue' },
  LIVE: { label: 'En cours', color: 'green' },
  PAST: { label: 'Terminée', color: 'gray' },
  CANCELLED: { label: 'Annulée', color: 'red' },
};

/** « 12/10/2026 », or « 12/10/2026 → 13/10/2026 » over several days; « — » when unknown. */
export function competitionDates(c: { date: string | null; endDate: string | null }): string {
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
