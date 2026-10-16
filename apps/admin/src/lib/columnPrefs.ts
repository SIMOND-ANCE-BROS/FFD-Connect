/**
 * Column preferences of a list, per table, in this browser only: the columns
 * an admin showed or hid (#444), the widths they dragged (#670) and the order
 * they chose (#671). Only what the admin touched is stored, so a column added
 * later still follows its default. Any storage failure (private window,
 * blocked site data, corrupt value) falls back to the default columns.
 */
export interface ColumnPrefs {
  /** Shown (true) or hidden (false), for the columns whose default was changed. */
  visible: Record<string, boolean>;
  /** Width in px of the columns resized by hand. */
  widths: Record<string, number>;
  /** Column keys in the order chosen; empty = the default order. */
  order: string[];
}

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = { visible: {}, widths: {}, order: [] };

/** Bounds of a column resized by hand, in px. */
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1200;
/** More keys than any list has columns: a longer stored order is corrupt. */
const MAX_ORDER_LENGTH = 50;

const PREFIX = 'ffd-admin.columns.';

export const columnPrefsKey = (tableId: string): string => `${PREFIX}${tableId}`;

export const clampColumnWidth = (width: number): number =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readVisible(value: unknown): Record<string, boolean> {
  const visible: Record<string, boolean> = {};
  if (!isRecord(value)) return visible;
  for (const [key, shown] of Object.entries(value)) {
    if (typeof shown === 'boolean') visible[key] = shown;
  }
  return visible;
}

function readWidths(value: unknown): Record<string, number> {
  const widths: Record<string, number> = {};
  if (!isRecord(value)) return widths;
  for (const [key, width] of Object.entries(value)) {
    if (typeof width === 'number' && Number.isFinite(width)) widths[key] = clampColumnWidth(width);
  }
  return widths;
}

function readOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ORDER_LENGTH) return [];
  const keys = value.filter((key): key is string => typeof key === 'string');
  return keys.length === value.length && new Set(keys).size === keys.length ? keys : [];
}

export function loadColumnPrefs(tableId: string): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(columnPrefsKey(tableId));
    if (!raw) return DEFAULT_COLUMN_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_COLUMN_PREFS;
    // Before #670 the entry was the visibility map alone: { email: false }.
    const structured = ['visible', 'widths', 'order'].some((k) => typeof parsed[k] === 'object');
    if (!structured) return { ...DEFAULT_COLUMN_PREFS, visible: readVisible(parsed) };
    return {
      visible: readVisible(parsed.visible),
      widths: readWidths(parsed.widths),
      order: readOrder(parsed.order),
    };
  } catch {
    return DEFAULT_COLUMN_PREFS;
  }
}

export const isDefaultColumnPrefs = (prefs: ColumnPrefs): boolean =>
  Object.keys(prefs.visible).length === 0 &&
  Object.keys(prefs.widths).length === 0 &&
  prefs.order.length === 0;

export function saveColumnPrefs(tableId: string, prefs: ColumnPrefs): void {
  try {
    if (isDefaultColumnPrefs(prefs)) {
      window.localStorage.removeItem(columnPrefsKey(tableId));
      return;
    }
    const stored: Partial<ColumnPrefs> = {};
    if (Object.keys(prefs.visible).length > 0) stored.visible = prefs.visible;
    if (Object.keys(prefs.widths).length > 0) stored.widths = prefs.widths;
    if (prefs.order.length > 0) stored.order = prefs.order;
    window.localStorage.setItem(columnPrefsKey(tableId), JSON.stringify(stored));
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
  return prefs.visible[column.key] ?? !column.hiddenByDefault;
}

/**
 * `columns` in the order the admin chose (#671). A column missing from the
 * stored order (added since) keeps its default place among the others; a
 * stored key that no longer exists is ignored.
 */
export function orderColumns<T extends { key: string }>(
  columns: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...columns];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = order.flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
  columns.forEach((column, index) => {
    if (!order.includes(column.key)) ordered.splice(Math.min(index, ordered.length), 0, column);
  });
  return ordered;
}

/** `keys` with `key` moved `delta` places (clamped to the ends). */
export function moveKey(keys: readonly string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key);
  if (from === -1) return [...keys];
  const to = Math.min(keys.length - 1, Math.max(0, from + delta));
  const next = keys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/** `keys` with `key` dropped just before or after `target` (drag and drop of a header). */
export function dropKey(
  keys: readonly string[],
  key: string,
  target: string,
  side: 'before' | 'after',
): string[] {
  if (key === target || !keys.includes(key) || !keys.includes(target)) return [...keys];
  const next = keys.filter((k) => k !== key);
  const at = next.indexOf(target) + (side === 'after' ? 1 : 0);
  next.splice(at, 0, key);
  return next;
}
