import { formatLicenseValidUntil } from './licenseDate';

describe('formatLicenseValidUntil (#238)', () => {
  it.each([
    // Season end as stored by the backend: last instant of 31/08 in Paris.
    ['2027-08-31T21:59:59.999Z', '31/08/2027'],
    // Seeded date-only value (02:00 in Paris).
    ['2026-08-31', '31/08/2026'],
    // 00:00 in Paris on 01/09 is already the next day.
    ['2027-08-31T22:00:00.000Z', '01/09/2027'],
  ])('%s → %s in Paris, whatever the browser time zone', (input, expected) => {
    expect(formatLicenseValidUntil(input)).toBe(expected);
    expect(formatLicenseValidUntil(new Date(input))).toBe(expected);
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatLicenseValidUntil('not a date')).toBe('');
  });
});
