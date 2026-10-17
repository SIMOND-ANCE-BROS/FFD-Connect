import { competitionDates, eventLabel, toCompetitionSummary } from './competitions';

describe('competition helpers', () => {
  it('maps the API fields to a summary', () => {
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

  it('leaves the place empty without location nor city', () => {
    expect(
      toCompetitionSummary({
        id: 'c2',
        title: 'Coupe',
        date: '2026-01-02T00:00:00.000Z',
        endDate: '2026-01-03T00:00:00.000Z',
        location: ' ',
        city: null,
        status: 'PAST',
      }),
    ).toEqual({
      id: 'c2',
      title: 'Coupe',
      date: '2026-01-02T00:00:00.000Z',
      endDate: '2026-01-03T00:00:00.000Z',
      place: null,
      status: 'PAST',
    });
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
