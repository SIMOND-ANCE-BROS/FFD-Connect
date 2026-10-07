export interface EditableFields {
  firstName: string;
  lastName: string;
  clubId: string | null;
  category: string | null;
  ageGroup: string | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  competitionLevel: string | null;
  nationalRanking: number | null;
  role: string;
}

const norm = (v: unknown) => (v === '' || v === undefined ? null : v);

/** Keys whose value changed; a cleared input becomes null (= clear). */
export function changedFields(
  initial: EditableFields,
  current: EditableFields,
): Partial<EditableFields> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof EditableFields)[]) {
    if (norm(initial[key]) !== norm(current[key])) out[key] = norm(current[key]);
  }
  return out as Partial<EditableFields>;
}

/** Select options, plus the current value when it predates the reference list. */
export function withLegacy(
  options: string[],
  value: string | null,
): { value: string; label: string }[] {
  const list = options.map((o) => ({ value: o, label: o }));
  if (value && !options.includes(value)) {
    list.push({ value, label: `${value} (valeur historique)` });
  }
  return list;
}
