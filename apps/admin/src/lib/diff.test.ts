import { changedFields, withLegacy } from './diff';

const base = {
  firstName: 'Jeanne',
  lastName: 'Martin',
  clubId: 'c1',
  category: 'Latine',
  ageGroup: 'Adulte',
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  nationalRanking: 12,
  role: 'LICENSEE',
  extraRoles: [] as string[],
};

describe('changedFields', () => {
  it('returns only changed keys', () => {
    expect(changedFields(base, { ...base, lastName: 'Durand' })).toEqual({
      lastName: 'Durand',
    });
  });
  it('maps cleared values to null', () => {
    expect(changedFields(base, { ...base, clubId: null, nationalRanking: null })).toEqual({
      clubId: null,
      nationalRanking: null,
    });
  });
  it('is empty when nothing changed (legacy value untouched)', () => {
    expect(changedFields(base, { ...base })).toEqual({});
  });

  it('treats extra roles as a set compared by value', () => {
    const a = { ...base, extraRoles: ['CLUB'] };
    expect(changedFields(a, { ...a, extraRoles: ['CLUB'] })).toEqual({});
    expect(changedFields(a, { ...a, extraRoles: ['STAFF', 'CLUB'] })).toEqual({
      extraRoles: ['STAFF', 'CLUB'],
    });
    expect(changedFields(a, { ...a, extraRoles: [] })).toEqual({ extraRoles: [] });
  });
});

describe('withLegacy', () => {
  it('keeps known values as is', () => {
    expect(withLegacy(['Latin', 'Standard'], 'Latin')).toEqual([
      { value: 'Latin', label: 'Latin' },
      { value: 'Standard', label: 'Standard' },
    ]);
  });
  it('formats labels while keeping raw values', () => {
    expect(withLegacy(['Latin'], 'latin', (v) => v.toUpperCase())).toEqual([
      { value: 'Latin', label: 'LATIN' },
      { value: 'latin', label: 'LATIN (valeur historique)' },
    ]);
  });
  it('appends an unknown current value so the select is not blank', () => {
    expect(withLegacy(['Latin'], 'Latine')).toContainEqual({
      value: 'Latine',
      label: 'Latine (valeur historique)',
    });
  });
});
