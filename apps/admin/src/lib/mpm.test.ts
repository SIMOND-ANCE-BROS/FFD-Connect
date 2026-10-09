// Shared with apps/backend/src/tracks/mpm-parity.spec.ts: one fixture, two implementations.
import cases from '../../../backend/test/fixtures/mpm-cases.json';
import { bpmForPatch, calculateMpm, normalizeDance } from './mpm';

describe('calculateMpm (mirror of BpmService.calculateMpm)', () => {
  it.each(cases)('$rawBpm BPM, $style → $mpm MPM', ({ rawBpm, style, mpm }) => {
    expect(calculateMpm(rawBpm, style)).toBe(mpm);
  });
});

describe('bpmForPatch (mirror of TracksService.bpmForPatch)', () => {
  it('keeps an explicit MPM', () => {
    expect(bpmForPatch(120, { bpm: 30, style: 'Rumba' })).toBe(30);
  });

  it('recomputes from the raw tempo on a dance change', () => {
    expect(bpmForPatch(100, { style: 'Rumba' })).toBe(25);
  });

  it('leaves the MPM alone without raw tempo, without dance, or with a cleared dance', () => {
    expect(bpmForPatch(0, { style: 'Rumba' })).toBeUndefined();
    expect(bpmForPatch(100, {})).toBeUndefined();
    expect(bpmForPatch(100, { style: '' })).toBeUndefined();
  });
});

describe('normalizeDance', () => {
  it('maps track-prep tokens and synonyms to a dance', () => {
    expect(normalizeDance('VALSE VIENNOISE')).toBe('viennoise');
    expect(normalizeDance('CHA-CHA')).toBe('cha-cha');
    expect(normalizeDance('Slowfox')).toBe('slow fox');
    expect(normalizeDance('AUTRE')).toBeNull();
    expect(normalizeDance(null)).toBeNull();
  });
});
