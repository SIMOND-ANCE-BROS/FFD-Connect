/**
 * Field-level diff for the audit log: only keys present in `after` are
 * compared; values are compared by JSON form so Dates compare by instant.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
