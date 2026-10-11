import { bucketLabel, durationLabel, parseStatsPeriod, rateLabel, seriesTotal } from './stats';

describe('stats helpers', () => {
  it('parses the period from the URL, defaulting to 12w', () => {
    expect(parseStatsPeriod('6m')).toBe('6m');
    expect(parseStatsPeriod('12m')).toBe('12m');
    expect(parseStatsPeriod(null)).toBe('12w');
    expect(parseStatsPeriod('1y')).toBe('12w');
  });

  it('labels buckets in French, whatever the viewer time zone', () => {
    expect(bucketLabel('2026-10-05', 'week')).toBe('5 oct.');
    expect(bucketLabel('2026-10-01', 'month')).toBe('oct. 2026');
  });

  it('formats rates with the denominator, dash when empty', () => {
    expect(rateLabel(3, 4)).toBe('75 % (3 / 4)');
    expect(rateLabel(1, 3)).toBe('33 % (1 / 3)');
    expect(rateLabel(0, 0)).toBe('—');
  });

  it('formats durations in hours below 48 h, else days', () => {
    expect(durationLabel(null)).toBe('—');
    expect(durationLabel(6.5)).toBe('6,5 h');
    expect(durationLabel(47.9)).toBe('47,9 h');
    expect(durationLabel(72)).toBe('3 j');
    expect(durationLabel(60)).toBe('2,5 j');
  });

  it('sums every numeric field of a series', () => {
    expect(
      seriesTotal([
        { start: '2026-10-05', LICENSEE: 2, CLUB: 1 },
        { start: '2026-10-12', LICENSEE: 0, CLUB: 4 },
      ]),
    ).toBe(7);
  });
});
