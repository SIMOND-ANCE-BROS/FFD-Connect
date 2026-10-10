/**
 * Stats periods (lot 4): bucket boundaries in Europe/Paris, computed in
 * TypeScript so they match the SQL `date_trunc(... AT TIME ZONE 'Europe/Paris')`
 * grouping exactly, DST included.
 */
export const STATS_PERIODS = ["12w", "6m", "12m"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export type StatsBucket = "week" | "month";

export interface StatsWindow {
  period: StatsPeriod;
  bucket: StatsBucket;
  /** Bucket starts as Paris calendar dates (YYYY-MM-DD), oldest first. */
  buckets: string[];
  /** First bucket's start (inclusive). */
  start: Date;
  /** End of the current bucket (exclusive). */
  end: Date;
  /** Today 00:00 in Paris. */
  today: Date;
}

export interface SeriesRow {
  start: string;
  key: string | null;
  count: number;
}

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

type WallClock = Record<
  "year" | "month" | "day" | "hour" | "minute" | "second",
  number
>;

const BUCKET_COUNT: Record<StatsPeriod, number> = {
  "12w": 12,
  "6m": 6,
  "12m": 12,
};

const parisFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parisWallClock(instant: Date): WallClock {
  const p: Record<string, number> = {};
  for (const part of parisFormat.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return p as WallClock;
}

/** Paris offset from UTC (ms) at an instant. */
function parisOffset(instant: Date): number {
  const w = parisWallClock(instant);
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 00:00 Paris on a calendar date. Paris never skips midnight (DST is at 02:00/03:00). */
function parisMidnight(c: CalendarDate): Date {
  const guess = Date.UTC(c.y, c.m - 1, c.d);
  const first = guess - parisOffset(new Date(guess));
  return new Date(guess - parisOffset(new Date(first)));
}

const fromUtc = (t: Date): CalendarDate => ({
  y: t.getUTCFullYear(),
  m: t.getUTCMonth() + 1,
  d: t.getUTCDate(),
});
const addDays = (c: CalendarDate, n: number) =>
  fromUtc(new Date(Date.UTC(c.y, c.m - 1, c.d + n)));
const addMonths = (c: CalendarDate, n: number) =>
  fromUtc(new Date(Date.UTC(c.y, c.m - 1 + n, 1)));
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (c: CalendarDate) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

function parisToday(now: Date): CalendarDate {
  const w = parisWallClock(now);
  return { y: w.year, m: w.month, d: w.day };
}

export function statsWindow(period: StatsPeriod, now: Date): StatsWindow {
  const today = parisToday(now);
  const bucket: StatsBucket = period === "12w" ? "week" : "month";
  let current: CalendarDate;
  let step: (c: CalendarDate, n: number) => CalendarDate;
  if (bucket === "week") {
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    current = addDays(today, -((dow + 6) % 7)); // back to Monday
    step = (c, n) => addDays(c, 7 * n);
  } else {
    current = { y: today.y, m: today.m, d: 1 };
    step = addMonths;
  }
  const count = BUCKET_COUNT[period];
  const starts = Array.from({ length: count }, (_, i) =>
    step(current, i - (count - 1)),
  );
  return {
    period,
    bucket,
    buckets: starts.map(isoDate),
    start: parisMidnight(starts[0]),
    end: parisMidnight(step(current, 1)),
    today: parisMidnight(today),
  };
}

/** 00:00 Paris, `days` calendar days after today (Paris). */
export function parisMidnightInDays(now: Date, days: number): Date {
  return parisMidnight(addDays(parisToday(now), days));
}

export function zeroFill<K extends string>(
  buckets: string[],
  rows: SeriesRow[],
  keys: readonly K[],
): Array<{ start: string } & Record<K, number>> {
  const byStart = new Map<string, Record<string, number | string>>(
    buckets.map((start) => [
      start,
      { start, ...Object.fromEntries(keys.map((k) => [k, 0])) },
    ]),
  );
  for (const r of rows) {
    const entry = byStart.get(r.start);
    if (
      entry &&
      r.key !== null &&
      (keys as readonly string[]).includes(r.key)
    ) {
      entry[r.key] = (entry[r.key] as number) + r.count;
    }
  }
  return [...byStart.values()] as Array<{ start: string } & Record<K, number>>;
}

export function zeroFillCount(
  buckets: string[],
  rows: SeriesRow[],
): Array<{ start: string; count: number }> {
  const totals = new Map(buckets.map((b) => [b, 0]));
  for (const r of rows) {
    const t = totals.get(r.start);
    if (t !== undefined) totals.set(r.start, t + r.count);
  }
  return buckets.map((start) => ({ start, count: totals.get(start) ?? 0 }));
}

const fromIso = (iso: string): CalendarDate => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

/** Paris calendar date (YYYY-MM-DD) of an instant. */
export function parisDateOf(instant: Date): string {
  return isoDate(parisToday(instant));
}

/** 00:00 Paris of a calendar date (YYYY-MM-DD). */
export function parisMidnightOf(iso: string): Date {
  return parisMidnight(fromIso(iso));
}

export function addIsoDays(iso: string, days: number): string {
  return isoDate(addDays(fromIso(iso), days));
}

/** Month arithmetic on the 1st of a month. */
export function addIsoMonths(iso: string, months: number): string {
  return isoDate(addMonths(fromIso(iso), months));
}
