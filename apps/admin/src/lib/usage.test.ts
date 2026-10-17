import {
  DAY_LABELS,
  formatMinutes,
  frDate,
  heatLevel,
  parseUsagePeriod,
  parseUsageSpace,
  share,
  weekSpansMonthStart,
} from './usage';

describe('usage helpers', () => {
  it('parses the period and the space from the URL', () => {
    expect(parseUsagePeriod('7d')).toBe('7d');
    expect(parseUsagePeriod('12m')).toBe('12m');
    expect(parseUsagePeriod('90d')).toBe('90d');
    expect(parseUsagePeriod(null)).toBe('30d');
    expect(parseUsagePeriod('1y')).toBe('30d');
    expect(parseUsageSpace('CLUB')).toBe('CLUB');
    expect(parseUsageSpace('ALL')).toBeUndefined();
    expect(parseUsageSpace('ROOT')).toBeUndefined();
    expect(parseUsageSpace(null)).toBeUndefined();
  });

  it('maps a cell to 5 levels relative to the largest cell', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(0, 0)).toBe(0);
  });

  it('labels days Monday first', () => {
    expect(DAY_LABELS).toEqual(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']);
  });

  it('formats minutes, shares and dates', () => {
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(7.5)).toBe('7,5 min');
    expect(formatMinutes(90)).toBe('1 h 30');
    expect(share(1, 4)).toBe('25 %');
    expect(share(0, 0)).toBe('—');
    expect(frDate('2026-10-09')).toBe('09/10/2026');
  });

  it('flags a 7-day window that spans the 1st of the month', () => {
    expect(weekSpansMonthStart('2026-10-01')).toBe(true);
    expect(weekSpansMonthStart('2026-10-06')).toBe(true);
    expect(weekSpansMonthStart('2026-10-07')).toBe(false);
    expect(weekSpansMonthStart('2026-10-31')).toBe(false);
  });
});
