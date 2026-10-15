// Shared with apps/backend/src/tracks/mpm-parity.spec.ts: one fixture, two implementations.
import cases from '../../../backend/test/fixtures/mpm-cases.json';
import danceCases from '../../../backend/test/fixtures/dance-style-cases.json';
import { bpmForPatch, calculateMpm, normalizeDance, toMpm } from './mpm';

describe('calculateMpm (mirror of BpmService.calculateMpm)', () => {
  it.each(cases)('$rawBpm BPM, $style → $mpm MPM', ({ rawBpm, style, mpm }) => {
    expect(calculateMpm(rawBpm, style)).toBe(mpm);
  });
});

describe('toMpm (mirror of BpmService.toMpm)', () => {
  it('converts a BPM typed as an MPM, keeps anything else', () => {
    expect(toMpm(87, 'Valse anglaise')).toBe(29);
    expect(toMpm(29, 'Valse Lente')).toBe(29);
    expect(toMpm(120, 'LATIN')).toBe(120);
  });
});

describe('bpmForPatch (mirror of TracksService.bpmForPatch)', () => {
  it('keeps an explicit MPM', () => {
    expect(bpmForPatch(120, { bpm: 30, style: 'Rumba' })).toBe(30);
  });

  it('converts an explicit BPM for the new or current dance (#338)', () => {
    expect(bpmForPatch(0, { bpm: 87, style: 'Valse Lente' })).toBe(29);
    expect(bpmForPatch(0, { bpm: 87 }, 'Valse Lente')).toBe(29);
  });

  it('recomputes from the raw tempo on a dance change', () => {
    expect(bpmForPatch(100, { style: 'Rumba' })).toBe(25);
  });

  it('clears the MPM when the new dance is unknown (#338)', () => {
    expect(bpmForPatch(100, { style: 'LATIN' })).toBe(0);
  });

  it('leaves the MPM alone without raw tempo, without dance, or with a cleared dance', () => {
    expect(bpmForPatch(0, { style: 'Rumba' })).toBeUndefined();
    expect(bpmForPatch(100, {})).toBeUndefined();
    expect(bpmForPatch(100, { style: '' })).toBeUndefined();
  });
});

describe('normalizeDance (mirror of the backend normalizeStyle)', () => {
  it.each(danceCases)('$style → $dance', ({ style, dance }) => {
    expect(normalizeDance(style)).toBe(dance);
  });
});
