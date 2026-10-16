import { competitionDates, eventLabel, toCompetitionSummary } from './competitions';

describe('competition helpers', () => {
  it('reads the fields the API actually answers', () => {
    expect(
      toCompetitionSummary({
        id: 'c1',
        title: 'Open de Lyon',
        date: '2026-11-07T00:00:00.000Z',
        endDate: null,
        location: 'Gymnase Jean Jaurès',
        city: 'Lyon',
        status: 'UPCOMING',
      }),
    ).toEqual({
      id: 'c1',
      title: 'Open de Lyon',
      date: '2026-11-07T00:00:00.000Z',
      endDate: null,
      place: 'Gymnase Jean Jaurès, Lyon',
      status: 'UPCOMING',
    });
  });

  it('falls back on the documented field names and skips rows without an id', () => {
    expect(toCompetitionSummary({ id: 'c2', name: 'Coupe', startDate: '2026-01-02' })).toEqual({
      id: 'c2',
      title: 'Coupe',
      date: '2026-01-02',
      endDate: null,
      place: null,
      status: null,
    });
    expect(toCompetitionSummary({ id: 'c3' })?.title).toBe('Compétition sans titre');
    expect(toCompetitionSummary({ title: 'x' })).toBeNull();
    expect(toCompetitionSummary(null)).toBeNull();
  });

  it('formats one day or a range', () => {
    expect(competitionDates({ date: null, endDate: null })).toBe('—');
    expect(competitionDates({ date: '2026-11-07T10:00:00', endDate: null })).toBe('07/11/2026');
    expect(competitionDates({ date: '2026-11-07T10:00:00', endDate: '2026-11-07T18:00:00' })).toBe(
      '07/11/2026',
    );
    expect(competitionDates({ date: '2026-11-07T10:00:00', endDate: '2026-11-08T18:00:00' })).toBe(
      '07/11/2026 → 08/11/2026',
    );
  });

  it('names an event as the CSV accepts it', () => {
    expect(eventLabel({ category: 'Latin', ageGroup: 'Adultes', level: 'Avancé' })).toBe(
      'Latines Adultes Avancé',
    );
    expect(eventLabel({ category: 'Standard', ageGroup: 'Juniors', level: null })).toBe(
      'Standards Juniors',
    );
  });
});
