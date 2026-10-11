import type { AdminTrackDto } from '../api/generated/types.gen';
import { API_ORIGIN } from '../config';
import {
  DANCE_LABELS,
  initialEditValues,
  readTracksParams,
  resultingBpm,
  STYLE_OPTIONS,
  titleConfirms,
  trackArtworkUrl,
  trackChangePreview,
  trackPatch,
  tracksFilter,
  writeTracksParams,
} from './tracks';

const track: AdminTrackDto = {
  id: 't1',
  title: 'Samba de Janeiro',
  artist: 'Bellini',
  style: 'Samba',
  bpm: 50,
  rawBpm: 100,
  clashTimecodes: [],
  titleMasked: false,
  blacklisted: false,
  status: 'READY',
  sourceKey: null,
  filename: 'a.mp3',
  artwork: 'a.jpg',
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
};

describe('style options', () => {
  it('lists the canonical dances then « Ambiance », in the backend order', () => {
    expect(STYLE_OPTIONS).toEqual([
      'Valse Lente',
      'Tango',
      'Valse Viennoise',
      'Quickstep',
      'Slow Fox',
      'Samba',
      'Cha-cha',
      'Rumba',
      'Paso Doble',
      'Jive',
      'Ambiance',
    ]);
    expect(DANCE_LABELS).toHaveLength(10);
    expect(DANCE_LABELS).not.toContain('Ambiance');
  });
});

describe('catalogue URL state', () => {
  it('defaults to every track, first page', () => {
    expect(readTracksParams(new URLSearchParams())).toEqual({
      q: '',
      status: null,
      blacklisted: false,
      titleMasked: false,
      ambiance: false,
      style: '',
      page: 1,
    });
  });

  it('reads every filter and drops unknown, too short or false values', () => {
    expect(
      readTracksParams(
        new URLSearchParams(
          'q=%20paso%20&status=ERROR&blacklisted=true&titleMasked=true&ambiance=true&style=Rumba&page=2',
        ),
      ),
    ).toEqual({
      q: 'paso',
      status: 'ERROR',
      blacklisted: true,
      titleMasked: true,
      ambiance: true,
      style: 'Rumba',
      page: 2,
    });
    expect(
      readTracksParams(new URLSearchParams('q=p&status=DONE&blacklisted=1&style=Valse&page=-3')),
    ).toEqual(readTracksParams(new URLSearchParams()));
  });

  it('writes only non-default values and goes back to page 1 on a filter change', () => {
    const current = new URLSearchParams('status=READY&page=4');
    expect(writeTracksParams(current, { ambiance: true }).toString()).toBe(
      'status=READY&ambiance=true',
    );
    expect(writeTracksParams(current, { page: 5 }).toString()).toBe('status=READY&page=5');
    expect(writeTracksParams(current, { status: null }).toString()).toBe('');
  });

  it('sends a chip as true only, never as false', () => {
    expect(tracksFilter(readTracksParams(new URLSearchParams()), 50)).toEqual({
      skip: 0,
      take: 50,
    });
    expect(
      tracksFilter(
        readTracksParams(
          new URLSearchParams('q=paso&status=PENDING&titleMasked=true&style=Jive&page=3'),
        ),
        50,
      ),
    ).toEqual({
      q: 'paso',
      status: 'PENDING',
      titleMasked: true,
      style: 'Jive',
      skip: 100,
      take: 50,
    });
  });
});

describe('PATCH body and preview', () => {
  const initial = initialEditValues(track);

  it('sends nothing when nothing changed', () => {
    expect(trackPatch(track, initial, false)).toEqual({});
  });

  it('leaves the MPM to the server on a dance change, and previews it', () => {
    const patch = trackPatch(track, { ...initial, style: 'Rumba' }, false);
    expect(patch).toEqual({ style: 'Rumba' });
    expect(resultingBpm(track, patch)).toBe(25);
    expect(trackChangePreview(track, patch)).toEqual({
      before: { style: 'Samba', bpm: 50 },
      after: { style: 'Rumba', bpm: 25 },
    });
  });

  it('sends a typed MPM, even unchanged when the dance changes, so it prevails', () => {
    expect(trackPatch(track, { ...initial, bpm: 52 }, true)).toEqual({ bpm: 52 });
    expect(trackPatch(track, { ...initial, bpm: 50 }, true)).toEqual({});
    expect(trackPatch(track, { ...initial, style: 'Rumba', bpm: 50 }, true)).toEqual({
      style: 'Rumba',
      bpm: 50,
    });
    expect(trackPatch(track, { ...initial, bpm: '' }, true)).toEqual({});
  });

  it('trims text, never sends a blank one, and sorts the clashes', () => {
    expect(
      trackPatch(
        track,
        { ...initial, title: '  Nouveau  ', artist: '   ', clashes: [80, 40, 80] },
        false,
      ),
    ).toEqual({ title: 'Nouveau', clashTimecodes: [40, 80] });
  });

  it('clears the dance with an empty style, keeping the MPM', () => {
    const patch = trackPatch(track, { ...initial, style: '' }, false);
    expect(patch).toEqual({ style: '' });
    expect(trackChangePreview(track, patch)).toEqual({
      before: { style: 'Samba' },
      after: { style: null },
    });
  });

  it('shows that an MPM publishes a track left in error', () => {
    const failed = { ...track, status: 'ERROR' as const, bpm: 0, rawBpm: 0 };
    const patch = trackPatch(failed, { ...initialEditValues(failed), bpm: 52 }, true);
    expect(trackChangePreview(failed, patch)).toEqual({
      before: { bpm: 0, status: 'ERROR' },
      after: { bpm: 52, status: 'READY' },
    });
  });
});

describe('small helpers', () => {
  it('confirms a deletion with the title, ignoring case and spaces', () => {
    expect(titleConfirms('  samba DE janeiro ', 'Samba de Janeiro')).toBe(true);
    expect(titleConfirms('Samba', 'Samba de Janeiro')).toBe(false);
    expect(titleConfirms('   ', '   ')).toBe(false);
  });

  it('serves the artwork from the API origin, name encoded', () => {
    expect(trackArtworkUrl('cover é.jpg')).toBe(`${API_ORIGIN}/uploads/cover%20%C3%A9.jpg`);
  });
});
