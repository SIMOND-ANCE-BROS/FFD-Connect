import type {
  TopTurnierCompetitionItemDto,
  TopTurnierCompetitionMatchDto,
} from '../api/generated/types.gen';

/**
 * TEMPORARY (#801, with #787): list of the recent competitions of the
 * TopTurnier site (chairperson), matched to the competitions of the app.
 */

export type ChairpersonMatchStatus = TopTurnierCompetitionMatchDto['status'];
export type ChairpersonItem = TopTurnierCompetitionItemDto;

export const MATCH_BADGES: Record<ChairpersonMatchStatus, { label: string; color: string }> = {
  MATCHED: { label: 'Rapprochée', color: 'green' },
  AMBIGUOUS: { label: 'À choisir', color: 'orange' },
  NONE: { label: 'Non trouvée', color: 'gray' },
};

/** Value of the year selector: one year, or both readable years. */
export type YearChoice = 'both' | `${number}`;

/** Years the API reads: the current one and the previous one (Europe/Paris). */
export function readableYears(now: Date = new Date()): [number, number] {
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric' }).format(now),
  );
  return [year, year - 1];
}

export function yearOptions(now: Date = new Date()): { value: YearChoice; label: string }[] {
  const [current, previous] = readableYears(now);
  return [
    { value: 'both', label: `${current} et ${previous}` },
    { value: `${current}`, label: `${current}` },
    { value: `${previous}`, label: `${previous}` },
  ];
}

/** `year` query parameter of a choice, undefined for both years. */
export function yearParam(choice: YearChoice): number | undefined {
  return choice === 'both' ? undefined : Number(choice);
}

/** True for a 404 error body: the feature is off on this environment. */
export function isDisabled(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 404
  );
}

/** « 17/10/2026 » from `YYYY-MM-DD`; « — » when unknown. */
export function formatDay(day: string | null): string {
  if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Competition of the app an entry would be imported into: the matched one,
 * or the candidate the staff picked for an ambiguous entry (only one of its
 * candidates). Never guessed: null otherwise.
 */
export function targetCompetition(
  item: ChairpersonItem,
  picked: string | null | undefined,
): string | null {
  if (item.match.status === 'MATCHED') return item.match.competitionId;
  if (item.match.status === 'AMBIGUOUS' && picked) {
    return item.match.candidates.some((c) => c.id === picked) ? picked : null;
  }
  return null;
}

/** « 12 compétitions, 8 rapprochées, 2 à choisir » */
export function listSummary(items: readonly ChairpersonItem[]): string {
  const count = (status: ChairpersonMatchStatus) =>
    items.filter((i) => i.match.status === status).length;
  const n = items.length;
  return `${n} compétition${n > 1 ? 's' : ''}, ${count('MATCHED')} rapprochée${
    count('MATCHED') > 1 ? 's' : ''
  }, ${count('AMBIGUOUS')} à choisir`;
}
