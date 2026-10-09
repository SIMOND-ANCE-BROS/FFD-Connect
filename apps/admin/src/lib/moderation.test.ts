import {
  formatTimecode,
  moderationFilter,
  nextPendingFilter,
  parseTimecode,
  proposalSummary,
  readModerationParams,
  roundTenth,
  writeModerationParams,
} from './moderation';

describe('timecodes', () => {
  it('formats m:ss, with the tenth only when it is not zero', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(40)).toBe('0:40');
    expect(formatTimecode(83.46)).toBe('1:23.5');
    expect(formatTimecode(59.96)).toBe('1:00');
  });

  it('parses m:ss, m:ss.d and plain seconds', () => {
    expect(parseTimecode('1:23.5')).toBe(83.5);
    expect(parseTimecode(' 0:40 ')).toBe(40);
    expect(parseTimecode('1:05,2')).toBe(65.2);
    expect(parseTimecode('83.5')).toBe(83.5);
    expect(parseTimecode('60:00')).toBe(3600);
  });

  it('refuses anything else, and beyond 3600 s', () => {
    for (const text of ['', 'abc', '1:60', '1:5', '-3', '60:01']) {
      expect(parseTimecode(text)).toBeNull();
    }
  });

  it('rounds to the tenth of a second', () => {
    expect(roundTenth(83.46)).toBe(83.5);
    expect(roundTenth(12.04)).toBe(12);
  });
});

describe('moderation URL state', () => {
  it('defaults to the pending queue', () => {
    expect(readModerationParams(new URLSearchParams())).toEqual({
      status: 'PENDING',
      reasons: [],
      q: '',
      page: 1,
    });
  });

  it('reads status, reasons, search and page, dropping unknown or too short values', () => {
    expect(
      readModerationParams(
        new URLSearchParams('status=REJECTED&reason=MPM,NOPE,TITLE&q=%20paso%20&page=3'),
      ),
    ).toEqual({ status: 'REJECTED', reasons: ['MPM', 'TITLE'], q: 'paso', page: 3 });
    expect(readModerationParams(new URLSearchParams('status=DONE&q=p&page=-1'))).toEqual({
      status: 'PENDING',
      reasons: [],
      q: '',
      page: 1,
    });
  });

  it('writes only non-default values and goes back to page 1 on a filter change', () => {
    const current = new URLSearchParams('reason=MPM&page=4');
    expect(writeModerationParams(current, { status: 'APPROVED' }).toString()).toBe(
      'status=APPROVED&reason=MPM',
    );
    expect(writeModerationParams(current, { page: 2 }).toString()).toBe('reason=MPM&page=2');
    expect(writeModerationParams(current, { reasons: [] }).toString()).toBe('');
  });

  it('builds the API filter of a page', () => {
    expect(moderationFilter({ status: 'PENDING', reasons: [], q: '', page: 1 }, 50)).toEqual({
      status: 'PENDING',
      skip: 0,
      take: 50,
    });
    expect(
      moderationFilter({ status: 'APPROVED', reasons: ['MPM'], q: 'paso', page: 3 }, 50),
    ).toEqual({ status: 'APPROVED', reason: ['MPM'], q: 'paso', skip: 100, take: 50 });
  });

  it('looks for the next proposal among the pending ones, whatever status the list shows', () => {
    expect(
      nextPendingFilter(new URLSearchParams('status=REJECTED&reason=MPM&q=paso&page=3')),
    ).toEqual({ status: 'PENDING', reason: ['MPM'], q: 'paso', skip: 0, take: 1 });
  });
});

describe('proposalSummary', () => {
  const none = { title: null, artist: null, style: null, bpm: null, clashTimecodes: null };

  it('lists the proposed values', () => {
    expect(proposalSummary({ ...none, title: 'Espana', bpm: 62 })).toBe(
      'Titre « Espana » · MPM 62',
    );
    expect(proposalSummary({ ...none, artist: 'X', style: 'Rumba' })).toBe(
      'Artiste « X » · Danse Rumba',
    );
    expect(proposalSummary({ ...none, clashTimecodes: [40, 83.5] })).toBe('Clashes 0:40, 1:23.5');
  });

  it('tells « no clash » apart from « no value proposed »', () => {
    expect(proposalSummary({ ...none, clashTimecodes: [] })).toBe('Aucun clash');
    expect(proposalSummary(none)).toBe('Message seul');
  });
});
