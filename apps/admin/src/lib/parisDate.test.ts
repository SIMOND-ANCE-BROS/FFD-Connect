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

  it('keeps the Paris calendar day around midnight', () => {
    vi.stubEnv('TZ', zone);
    expect(formatParisDay('2026-10-31T23:30:00.000Z')).toBe('01/11/2026');
    expect(formatParisDay('2026-10-31T22:59:59.000Z')).toBe('31/10/2026');
    // Date-only values (competitions) are UTC midnight: same day in Paris.
    expect(formatParisDay('2026-11-14')).toBe('14/11/2026');
  });
});

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
      .filter(([, code]) =>
        // dayjs display formats, and date toLocale*String without an explicit zone.
        /\.format\(\s*'DD\/MM|\.toLocale(?:Date|Time)String\((?![^)]*timeZone)/.test(code),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('missing or invalid dates', () => {
  it.each([null, undefined, '', 'not a date'])('shows a dash for %p', (value) => {
    expect(parseInstant(value)).toBeNull();
    expect(formatParisDay(value)).toBe(NO_DATE);
    expect(formatParisDateTime(value)).toBe(NO_DATE);
  });
});
