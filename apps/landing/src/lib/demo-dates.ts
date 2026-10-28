// The preview uses fictional competitions. Their dates are placed relative to
// the visitor's day so an "À venir" event never shows a date already past.
const DAY_MS = 24 * 60 * 60 * 1000;

const longDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

function shift(today: Date, days: number): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(start.getTime() + days * DAY_MS + DAY_MS / 2);
}

/** "24 octobre 2026" style date, `days` after (or before) today. */
export function demoDate(days: number, today: Date = new Date()): string {
  return longDate.format(shift(today, days));
}

/** "18 octobre" style date, `days` after (or before) today. */
export function demoDayMonth(days: number, today: Date = new Date()): string {
  return shortDate.format(shift(today, days));
}

/** Sporting season label: a season starts in September ("2026-2027"). */
export function demoSeason(today: Date = new Date()): string {
  const start = seasonStartYear(today);
  return `${start}-${start + 1}`;
}

/** Last day of the current season, when a licence expires ("31/08/2027"). */
export function demoSeasonEnd(today: Date = new Date()): string {
  return `31/08/${seasonStartYear(today) + 1}`;
}

function seasonStartYear(today: Date): number {
  return today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
}
