/**
 * Every date the back-office shows is expressed in Europe/Paris, whatever the
 * browser's time zone (#683): the FFD, its clubs and its staff are in France,
 * and an administrator travelling abroad must read the same hour on every
 * page (audit log, renewals, refunds, statistics…). Format instants with
 * these helpers, never with `dayjs(…).format` or `toLocale*String` without a
 * `timeZone`.
 *
 * Calendar days that are not instants (`YYYY-MM-DD` filter values) are
 * formatted elsewhere: they have no time zone.
 */
export const PARIS_TIME_ZONE = 'Europe/Paris';

/** Shown when the date is missing or unparseable. */
export const NO_DATE = '—';

export type DateInput = string | Date | null | undefined;

const parisDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const parisTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The instant, or null when missing or unparseable. An ISO datetime string
 * without an offset (`2026-10-11T22:30`) is parsed in the browser's zone,
 * not in Paris: the API always sends UTC with a `Z`, so server data never
 * hits this. A date-only string (`2026-11-14`) is UTC midnight.
 */
export function parseInstant(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `DD/MM/YYYY` in Europe/Paris; {@link NO_DATE} when missing or unparseable. */
export function formatParisDay(value: DateInput): string {
  const date = parseInstant(value);
  return date ? parisDay.format(date) : NO_DATE;
}

/** `DD/MM/YYYY HH:mm` in Europe/Paris; {@link NO_DATE} when missing or unparseable. */
export function formatParisDateTime(value: DateInput): string {
  const date = parseInstant(value);
  return date ? `${parisDay.format(date)} ${parisTime.format(date)}` : NO_DATE;
}
