/**
 * Columns an admin showed or hid in a list (#444), per table, in this browser
 * only. Only the columns the admin touched are stored, so a column added later
 * still follows its default. Any storage failure (private window, blocked site
 * data, corrupt value) falls back to the default columns.
 */
export type ColumnPrefs = Record<string, boolean>;

const PREFIX = 'ffd-admin.columns.';

export const columnPrefsKey = (tableId: string): string => `${PREFIX}${tableId}`;

export function loadColumnPrefs(tableId: string): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(columnPrefsKey(tableId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const prefs: ColumnPrefs = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') prefs[key] = value;
    }
    return prefs;
  } catch {
    return {};
  }
}

export function saveColumnPrefs(tableId: string, prefs: ColumnPrefs): void {
  try {
    if (Object.keys(prefs).length === 0) {
      window.localStorage.removeItem(columnPrefsKey(tableId));
    } else {
      window.localStorage.setItem(columnPrefsKey(tableId), JSON.stringify(prefs));
    }
  } catch {
    // Not remembered: the choice still applies until the page is left.
  }
}

export interface ColumnVisibility {
  key: string;
  /** Identification column: always shown, not offered in the picker. */
  required?: boolean;
  /** Off until the admin ticks it. */
  hiddenByDefault?: boolean;
}

export function isColumnVisible(column: ColumnVisibility, prefs: ColumnPrefs): boolean {
  if (column.required) return true;
  return prefs[column.key] ?? !column.hiddenByDefault;
}
