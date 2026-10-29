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

export type DemoStatus = 'À venir' | 'En cours' | 'Passées';

/** Status of a one-day fictional event held `days` after (or before) today. */
export function demoStatus(days: number): DemoStatus {
  if (days > 0) return 'À venir';
  return days === 0 ? 'En cours' : 'Passées';
}

/**
 * Season of the date `days` after (or before) today, with its French
 * preposition ("d’automne", "de printemps"), so an event named after a
 * season never contradicts its own date.
 */
export function demoSeasonOf(days: number, today: Date = new Date()): string {
  const month = shift(today, days).getMonth();
  if (month >= 2 && month <= 4) return 'de printemps';
  if (month >= 5 && month <= 7) return 'd’été';
  if (month >= 8 && month <= 10) return 'd’automne';
  return 'd’hiver';
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
