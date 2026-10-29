import { describe, expect, it } from 'vitest';
import { demoDate, demoDayMonth, demoSeason, demoSeasonEnd } from './demo-dates';

describe('demo dates', () => {
  const today = new Date(2026, 9, 28); // 28 October 2026

  it('places dates relative to today', () => {
    expect(demoDate(0, today)).toBe('28 octobre 2026');
    expect(demoDate(26, today)).toBe('23 novembre 2026');
    expect(demoDate(-46, today)).toBe('12 septembre 2026');
  });

  it('formats a day and month without the year', () => {
    expect(demoDayMonth(20, today)).toBe('17 novembre');
  });

  it('crosses the end of the year', () => {
    expect(demoDate(5, new Date(2026, 11, 30))).toBe('4 janvier 2027');
  });

  it('starts the season in September', () => {
    expect(demoSeason(today)).toBe('2026-2027');
    expect(demoSeason(new Date(2027, 7, 31))).toBe('2026-2027');
    expect(demoSeason(new Date(2027, 8, 1))).toBe('2027-2028');
    expect(demoSeasonEnd(today)).toBe('31/08/2027');
  });
});
