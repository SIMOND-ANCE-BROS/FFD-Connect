import { describe, expect, it } from 'vitest';
import {
  type ChairpersonItem,
  formatDay,
  isDisabled,
  listSummary,
  readableYears,
  targetCompetition,
  yearOptions,
  yearParam,
} from './chairperson';

const item = (match: ChairpersonItem['match']): ChairpersonItem => ({
  date: '2026-10-17',
  title: 'Exempleville',
  category: null,
  exportUrl: 'https://chairperson.ddsbagnols.com/resultats/x/index.htm',
  match,
  resultsAlreadyImported: false,
});

describe('chairperson list helpers (#801)', () => {
  it('reads the current and previous year in Paris', () => {
    expect(readableYears(new Date('2026-12-31T23:30:00Z'))).toEqual([2027, 2026]);
    expect(yearOptions(new Date('2026-10-20T12:00:00Z'))).toEqual([
      { value: 'both', label: '2026 et 2025' },
      { value: '2026', label: '2026' },
      { value: '2025', label: '2025' },
    ]);
    expect(yearParam('both')).toBeUndefined();
    expect(yearParam('2025')).toBe(2025);
  });

  it('recognises the « feature off » answer', () => {
    expect(isDisabled({ statusCode: 404, message: 'x' })).toBe(true);
    expect(isDisabled({ statusCode: 502 })).toBe(false);
    expect(isDisabled(new TypeError('fetch'))).toBe(false);
    expect(isDisabled(null)).toBe(false);
  });

  it('formats a day', () => {
    expect(formatDay('2026-10-17')).toBe('17/10/2026');
    expect(formatDay(null)).toBe('—');
    expect(formatDay('17 oct')).toBe('—');
  });

  it('only targets a matched competition or a picked candidate', () => {
    expect(
      targetCompetition(item({ status: 'MATCHED', competitionId: 'a', candidates: [] }), null),
    ).toBe('a');
    const ambiguous = item({
      status: 'AMBIGUOUS',
      competitionId: null,
      candidates: [
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ],
    });
    expect(targetCompetition(ambiguous, null)).toBeNull();
    expect(targetCompetition(ambiguous, 'c')).toBe('c');
    expect(targetCompetition(ambiguous, 'zzz')).toBeNull();
    expect(
      targetCompetition(item({ status: 'NONE', competitionId: null, candidates: [] }), 'a'),
    ).toBeNull();
  });

  it('summarises the list', () => {
    expect(
      listSummary([
        item({ status: 'MATCHED', competitionId: 'a', candidates: [] }),
        item({ status: 'MATCHED', competitionId: 'b', candidates: [] }),
        item({ status: 'NONE', competitionId: null, candidates: [] }),
      ]),
    ).toBe('3 compétitions, 2 rapprochées, 0 à choisir');
    expect(listSummary([])).toBe('0 compétition, 0 rapprochée, 0 à choisir');
  });
});
