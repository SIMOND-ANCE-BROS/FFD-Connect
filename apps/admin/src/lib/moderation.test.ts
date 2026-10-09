import type { TrackCorrectionAdminDto } from '../api/generated/types.gen';
import { API_ORIGIN } from '../config';
import {
  approvalPreview,
  approveOverrides,
  formatTimecode,
  initialReviewValues,
  insertTemplate,
  moderationFilter,
  nextPendingFilter,
  parseTimecode,
  proposalSummary,
  readModerationParams,
  roundTenth,
  trackAudioUrl,
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

const correction: TrackCorrectionAdminDto = {
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: null,
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'España Cañí.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
};

describe('review values', () => {
  it('start from the proposal, falling back on the current track', () => {
    expect(initialReviewValues(correction)).toEqual({
      title: 'España Cañí',
      artist: 'Orchestre',
      style: 'Paso Doble',
      bpm: 62,
      clashes: [40, 80],
    });
    expect(
      initialReviewValues({
        ...correction,
        proposed: { ...correction.proposed, bpm: null, clashTimecodes: [] },
        track: { ...correction.track, style: null },
      }),
    ).toMatchObject({ style: '', bpm: 62, clashes: [] });
  });

  it('send only what the admin changed', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, initial)).toEqual({});
    expect(approveOverrides(initial, { ...initial, title: ' Espana ', bpm: 61 })).toEqual({
      title: 'Espana',
      bpm: 61,
    });
  });

  it('send an emptied clash list as [] and an untouched one not at all', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, { ...initial, clashes: [] })).toEqual({
      clashTimecodes: [],
    });
    expect(approveOverrides(initial, { ...initial, clashes: [80, 40] })).toEqual({});
    expect(approveOverrides(initial, { ...initial, clashes: [83.5, 40] })).toEqual({
      clashTimecodes: [40, 83.5],
    });
  });

  it('never send a blanked text field or an empty MPM', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, { ...initial, title: '   ', bpm: '' })).toEqual({});
  });
});

describe('approvalPreview', () => {
  it('shows the fields that will change, from the current values', () => {
    expect(approvalPreview(correction, {})).toEqual({
      before: { bpm: 60 },
      after: { bpm: 62 },
    });
    expect(approvalPreview(correction, { clashTimecodes: [] })).toEqual({
      before: { bpm: 60, clashTimecodes: [40, 80] },
      after: { bpm: 62, clashTimecodes: [] },
    });
  });

  it('warns that the MPM is recalculated when only the dance is overridden', () => {
    expect(approvalPreview(correction, { style: 'Rumba' }).after).toEqual({
      style: 'Rumba',
      bpm: 'recalculé selon la danse',
    });
  });
});

describe('insertTemplate', () => {
  it('fills an empty comment, or appends on a new line', () => {
    expect(insertTemplate('', 'Déjà corrigé')).toBe('Déjà corrigé');
    expect(insertTemplate('Bonjour  ', 'Déjà corrigé')).toBe('Bonjour\nDéjà corrigé');
  });
});

describe('trackAudioUrl', () => {
  it('points at /uploads on the API origin, outside /api/v1, with an encoded name', () => {
    expect(trackAudioUrl('España Cañí.mp3')).toBe(
      `${API_ORIGIN}/uploads/Espa%C3%B1a%20Ca%C3%B1%C3%AD.mp3`,
    );
    expect(trackAudioUrl('x.mp3')).not.toContain('/api/v');
  });
});
