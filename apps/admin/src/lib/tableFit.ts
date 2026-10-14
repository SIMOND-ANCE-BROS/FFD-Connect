/**
 * Fitting a back-office table into the width of the screen (#556): no
 * horizontal scroll. Every visible column has a minimum width and a relative
 * weight; when their minimums do not fit, the least important columns move
 * into a detail row the admin unfolds per line. Pure functions, so the
 * DataTable only measures its container.
 */

/** Default minimum width of a column, in px: a short label or a date. */
export const DEFAULT_MIN_WIDTH = 110;
/** Width of the unfold button column shown once a column is moved out, in px. */
export const EXPANDER_WIDTH = 44;

export interface FitColumn {
  key: string;
  /** Narrowest readable width, in px. */
  minWidth: number;
  /** Share of the width left once every minimum is served (1 by default). */
  weight: number;
  /** Lower first: the highest numbers leave the table first. */
  priority: number;
  /** Never moved out (identification column, active filter or sort). */
  pinned: boolean;
}

export interface FitResult {
  /** Keys of the columns kept in the table, in their original order. */
  shown: string[];
  /** Keys moved into the detail row, in their original order. */
  hidden: string[];
  /** Width of each shown column, in % of the table (the expander included). */
  widths: Record<string, string>;
  /** Width of the expander column, in %; null when nothing is hidden. */
  expanderWidth: string | null;
}

const percent = (value: number): string => `${Math.round(value * 10000) / 100}%`;

/**
 * Splits `columns` between the table and the detail row for a container of
 * `available` px. An unmeasured container (0: first render, tests) keeps
 * every column and splits the width by weight only.
 */
export function fitColumns(columns: readonly FitColumn[], available: number): FitResult {
  const minTotal = columns.reduce((sum, c) => sum + c.minWidth, 0);
  let kept: FitColumn[];
  if (available <= 0 || minTotal <= available) {
    kept = [...columns];
  } else {
    const budget = available - EXPANDER_WIDTH;
    const picked = new Set<string>();
    let used = 0;
    for (const c of columns) {
      if (c.pinned) {
        picked.add(c.key);
        used += c.minWidth;
      }
    }
    const candidates = columns
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => !c.pinned)
      .sort((a, b) => a.c.priority - b.c.priority || a.index - b.index);
    for (const { c } of candidates) {
      if (used + c.minWidth > budget) continue;
      picked.add(c.key);
      used += c.minWidth;
    }
    kept = columns.filter((c) => picked.has(c.key));
  }

  const hidden = columns.filter((c) => !kept.includes(c)).map((c) => c.key);
  const widths: Record<string, string> = {};
  const totalWeight = kept.reduce((sum, c) => sum + c.weight, 0) || 1;

  if (available <= 0) {
    for (const c of kept) widths[c.key] = percent(c.weight / totalWeight);
    return { shown: kept.map((c) => c.key), hidden, widths, expanderWidth: null };
  }

  const expander = hidden.length > 0 ? EXPANDER_WIDTH : 0;
  const keptMin = kept.reduce((sum, c) => sum + c.minWidth, 0);
  const spare = Math.max(0, available - expander - keptMin);
  // Pinned columns may overflow a very narrow container: shares then follow the minimums.
  const base = Math.max(available, keptMin + expander);
  for (const c of kept) {
    widths[c.key] = percent((c.minWidth + (spare * c.weight) / totalWeight) / base);
  }
  return {
    shown: kept.map((c) => c.key),
    hidden,
    widths,
    expanderWidth: hidden.length > 0 ? percent(expander / base) : null,
  };
}
