export type UsagePeriod = '7d' | '30d' | '12m';
export type UsageSpace = 'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN' | 'GUEST';

export const USAGE_PERIOD_OPTIONS: { value: UsagePeriod; label: string }[] = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '12m', label: '12 mois' },
];

export const USAGE_SPACE_OPTIONS: { value: UsageSpace | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'LICENSEE', label: 'Licencié' },
  { value: 'CLUB', label: 'Club' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'GUEST', label: 'Invité' },
];

export function parseUsagePeriod(raw: string | null): UsagePeriod {
  return USAGE_PERIOD_OPTIONS.find((o) => o.value === raw)?.value ?? '30d';
}

export function parseUsageSpace(raw: string | null): UsageSpace | undefined {
  const found = USAGE_SPACE_OPTIONS.find((o) => o.value === raw);
  return found && found.value !== 'ALL' ? found.value : undefined;
}

export const DAY_LABELS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** 0 = empty, 1..4 = quarters of the largest cell. */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${decimal.format(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function share(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)} %`;
}

/** YYYY-MM-DD → JJ/MM/AAAA. */
export function frDate(iso: string): string {
  return iso.split('-').reverse().join('/');
}
