/**
 * Display labels for dance disciplines (a.k.a. "category" / "style").
 *
 * The API stores and returns raw values ("Latin", "Standard", "Ten Dance",
 * sometimes lowercase or French variants). This helper only turns them into
 * the French copy shown to users — never use its output as a stored or sent
 * value.
 *
 * Keep in sync with apps/client/src/utils/discipline.ts (same behaviour, same
 * tests).
 */

export const DISCIPLINE_LABELS = {
  latin: 'Latines',
  standard: 'Standards',
  tenDance: '10 danses',
} as const;

type DisciplineKey = keyof typeof DISCIPLINE_LABELS;

const ALIASES: Partial<Record<string, DisciplineKey>> = {
  latin: 'latin',
  latins: 'latin',
  latine: 'latin',
  latines: 'latin',
  standard: 'standard',
  standards: 'standard',
  tendance: 'tenDance',
  tendances: 'tenDance',
  '10dance': 'tenDance',
  '10dances': 'tenDance',
  '10danse': 'tenDance',
  '10danses': 'tenDance',
  dixdanses: 'tenDance',
};

/** Lowercase, strip accents and every non-alphanumeric character. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * French label for a discipline value: "Latin" → "Latines", "STANDARD" →
 * "Standards", "Ten Dance" / "10 danses" → "10 danses". Unknown values are
 * returned unchanged; null/undefined become an empty string.
 */
export function formatDiscipline(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const key = ALIASES[normalize(value)];
  return key ? DISCIPLINE_LABELS[key] : value;
}

/** Select options that keep the raw value and show the French label. */
export function disciplineOptions(values: readonly string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: formatDiscipline(value) }));
}
