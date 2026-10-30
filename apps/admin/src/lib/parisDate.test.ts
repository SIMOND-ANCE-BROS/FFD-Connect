import { afterAll, describe, expect, it, vi } from 'vitest';
import { formatParisDateTime, formatParisDay, NO_DATE, parseInstant } from './parisDate';

/**
 * Node re-reads `TZ` whenever the environment variable changes, so each block
 * below runs with a different "browser" time zone (the first test of each
 * block proves it). The output must never change (#683).
 */
const BROWSER_ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Europe/Paris'];

afterAll(() => {
  vi.unstubAllEnvs();
});

describe.each(BROWSER_ZONES)('with the browser in %s', (zone) => {
  it('really runs in that time zone', () => {
    vi.stubEnv('TZ', zone);
    // 2026-01-15 12:00 UTC: the offset (minutes) only matches in that zone.
    const offsets: Record<string, number> = {
      UTC: 0,
      'America/Los_Angeles': 480,
      'Asia/Tokyo': -540,
      'Europe/Paris': -60,
    };
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(offsets[zone]);
  });

  it.each([
    // Summer time (UTC+2): 22:30 UTC is already the next day in Paris.
    ['2026-10-11T22:30:00.000Z', '12/10/2026 00:30'],
    // Winter time (UTC+1).
    ['2026-12-01T10:00:00.000Z', '01/12/2026 11:00'],
    // Evening in Los Angeles, next morning in Paris.
    ['2026-03-01T07:15:00.000Z', '01/03/2026 08:15'],
  ])('formats %s as %s', (iso, expected) => {
    vi.stubEnv('TZ', zone);
    expect(formatParisDateTime(iso)).toBe(expected);
    expect(formatParisDateTime(new Date(iso))).toBe(expected);
    expect(formatParisDay(iso)).toBe(expected.slice(0, 10));
  });

  it.each([
    // Autumn changeover (25/10/2026): 03:00 summer time falls back to 02:00,
    // so 02:30 Paris happens twice, first at UTC+2, then at UTC+1.
    ['2026-10-25T00:30:00.000Z', '25/10/2026 02:30'],
    ['2026-10-25T01:30:00.000Z', '25/10/2026 02:30'],
    // Spring changeover (29/03/2026): 02:00 jumps to 03:00, so 01:30 UTC is
    // already summer time.
    ['2026-03-29T01:30:00.000Z', '29/03/2026 03:30'],
  ])('formats %s as %s across the DST changeover night', (iso, expected) => {
    vi.stubEnv('TZ', zone);
    expect(formatParisDateTime(iso)).toBe(expected);
  });

  it('keeps the Paris calendar day around midnight', () => {
    vi.stubEnv('TZ', zone);
    expect(formatParisDay('2026-10-31T23:30:00.000Z')).toBe('01/11/2026');
    expect(formatParisDay('2026-10-31T22:59:59.000Z')).toBe('31/10/2026');
    // Date-only values (competitions) are UTC midnight: same day in Paris.
    expect(formatParisDay('2026-11-14')).toBe('14/11/2026');
  });
});

/** Block and line comments, so a doc comment quoting a pattern is not flagged. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Display formats that read the browser time zone: dayjs `.format` with a
 * day-first or hour pattern (any quote), `toLocaleDateString` /
 * `toLocaleTimeString` and `new Intl.DateTimeFormat` without `timeZone`.
 * `toLocaleString` is left out: it is used for numbers (resultsImport.ts).
 * `YYYY-MM-DD` is a calendar-day value, not an instant: not flagged.
 */
const BROWSER_ZONE_FORMAT =
  /\.format\(\s*['"`][^'"`]*(?:DD\/|HH)|\.toLocale(?:Date|Time)String\((?![^)]*timeZone)|new Intl\.DateTimeFormat\((?![^)]*timeZone)/;

function formatsInBrowserZone(code: string): boolean {
  return BROWSER_ZONE_FORMAT.test(stripComments(code));
}

describe('back-office sources', () => {
  // Every source file of the app, tests and generated client excluded.
  const sources = Object.entries(
    import.meta.glob<string>(
      ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../api/generated/**'],
      {
        query: '?raw',
        import: 'default',
        eager: true,
      },
    ),
  );

  it('are actually scanned', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('never format an instant in the browser time zone', () => {
    const offenders = sources
      .filter(([file]) => !file.endsWith('/parisDate.ts'))
      .filter(([, code]) => formatsInBrowserZone(code))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('browser-zone formatting detector', () => {
  it.each([
    [`dayjs(d).format('DD/MM/YYYY')`],
    [`dayjs(d).format("DD/MM/YYYY HH:mm")`],
    ['dayjs(d).format(`DD/MM`)'],
    [`dayjs(d).format('HH:mm')`],
    [`dayjs(d).format( 'YYYY HH' )`],
    [`d.toLocaleDateString('fr-FR')`],
    [`d.toLocaleTimeString('fr-FR', { hour: '2-digit' })`],
    [`new Intl.DateTimeFormat('fr-FR', { day: '2-digit' })`],
    [`new Intl.DateTimeFormat('fr-FR', {\n  month: 'short',\n})`],
  ])('flags %s', (code) => {
    expect(formatsInBrowserZone(code)).toBe(true);
  });

  it.each([
    // Explicit zone.
    [`d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })`],
    [`new Intl.DateTimeFormat('fr-FR', {\n  timeZone: 'UTC',\n})`],
    // Calendar-day values (filters) have no time zone.
    [`dayjs(value).format('YYYY-MM-DD')`],
    // Number formatting (resultsImport.ts) is not a date.
    [`value.toLocaleString('fr-FR')`],
    // Comments are not code.
    [`// never dayjs(d).format('DD/MM/YYYY')`],
    [`/* new Intl.DateTimeFormat('fr-FR') */`],
    [`/**\n * d.toLocaleDateString('fr-FR')\n */`],
  ])('ignores %s', (code) => {
    expect(formatsInBrowserZone(code)).toBe(false);
  });
});

describe('missing or invalid dates', () => {
  it.each([null, undefined, '', 'not a date'])('shows a dash for %p', (value) => {
    expect(parseInstant(value)).toBeNull();
    expect(formatParisDay(value)).toBe(NO_DATE);
    expect(formatParisDateTime(value)).toBe(NO_DATE);
  });
});
