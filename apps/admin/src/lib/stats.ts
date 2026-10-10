export type StatsPeriod = '12w' | '6m' | '12m';

export const STATS_PERIOD_OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: '12w', label: '12 semaines' },
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
];

export function parseStatsPeriod(raw: string | null): StatsPeriod {
  const found = STATS_PERIOD_OPTIONS.find((o) => o.value === raw);
  return found ? found.value : '12w';
}

// Bucket keys are Paris calendar dates: format them as UTC dates so the
// viewer's own time zone never shifts the day.
const weekFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function bucketLabel(start: string, bucket: 'week' | 'month'): string {
  const date = new Date(`${start}T00:00:00Z`);
  return (bucket === 'week' ? weekFormat : monthFormat).format(date);
}

export function rateLabel(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)} % (${part} / ${total})`;
}

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function durationLabel(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${decimal.format(hours)} h`;
  return `${decimal.format(Math.round((hours / 24) * 10) / 10)} j`;
}

export function seriesTotal(rows: Array<Record<string, number | string>>): number {
  let total = 0;
  for (const row of rows) {
    for (const v of Object.values(row)) if (typeof v === 'number') total += v;
  }
  return total;
}
