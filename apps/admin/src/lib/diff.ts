export interface EditableFields {
  firstName: string;
  lastName: string;
  clubId: string | null;
  category: string | null;
  ageGroup: string | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  competitionLevelLatin: string | null;
  competitionLevelStandard: string | null;
  nationalRanking: number | null;
  role: string;
  extraRoles: string[];
}

const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...((a as string[]) ?? [])].sort()) ===
      JSON.stringify([...((b as string[]) ?? [])].sort())
    : norm(a) === norm(b);

/** Keys whose value changed; a cleared input becomes null (= clear). */
export function changedFields(
  initial: EditableFields,
  current: EditableFields,
): Partial<EditableFields> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof EditableFields)[]) {
    if (!same(initial[key], current[key])) out[key] = norm(current[key]);
  }
  return out as Partial<EditableFields>;
}

/** Select options, plus the current value when it predates the reference list. */
export function withLegacy(
  options: string[],
  value: string | null,
  format: (raw: string) => string = (raw) => raw,
): { value: string; label: string }[] {
  const list = options.map((o) => ({ value: o, label: format(o) }));
  if (value && !options.includes(value)) {
    list.push({ value, label: `${format(value)} (valeur historique)` });
  }
  return list;
}

/**
 * Read-only hint for the deprecated single competition level: shown only
 * while neither per-discipline level is set (the backend backfilled them, so
 * this is a leftover from an older write).
 */
export function legacyCompetitionLevelHint(user: {
  competitionLevel?: string | null;
  competitionLevelLatin?: string | null;
  competitionLevelStandard?: string | null;
}): string | undefined {
  if (user.competitionLevelLatin || user.competitionLevelStandard) return undefined;
  const legacy = user.competitionLevel?.trim();
  return legacy ? `Ancien niveau unique : ${legacy}` : undefined;
}
