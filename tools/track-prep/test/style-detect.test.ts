import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectStyleFromTempo, detectStyleFromTitle } from '../src/style-detect.js';

test('detectStyleFromTitle — danse mentionnée dans un titre ou nom de playlist', () => {
  assert.equal(detectStyleFromTitle('Samba de Janeiro'), 'Samba');
  assert.equal(detectStyleFromTitle('Sway (Cha Cha)'), 'Cha-cha');
  assert.equal(detectStyleFromTitle('Playlist QUICKSTEP compétition 2026'), 'Quickstep');
  assert.equal(detectStyleFromTitle('Best of Foxtrot'), 'Slow Fox');
  assert.equal(detectStyleFromTitle(null, undefined, 'Libertango'), 'Tango');
});

test('detectStyleFromTitle — titre sans danse : null', () => {
  assert.equal(detectStyleFromTitle('Shape of You'), null);
  assert.equal(detectStyleFromTitle(''), null);
});

test('detectStyleFromTempo — tempo discriminant : une seule danse retenue', () => {
  // 200 BPM : seul le Quickstep est plausible sans décalage d'octave.
  const quickstep = detectStyleFromTempo(200);
  assert.equal(quickstep.best, 'Quickstep');

  // 87 BPM : Valse Lente, nettement devant les candidates par octave.
  const valse = detectStyleFromTempo(87);
  assert.equal(valse.best, 'Valse Lente');
});

test('detectStyleFromTempo — plages qui se recouvrent : ambigu, candidates listées', () => {
  // 104 BPM : Samba (90-115) et Rumba (95-115) indissociables par le tempo.
  const detection = detectStyleFromTempo(104);
  assert.equal(detection.best, null);
  const labels = detection.candidates.map((c) => c.label);
  assert.ok(labels.includes('Samba'));
  assert.ok(labels.includes('Rumba'));
  // Le MPM proposé par candidate suit la table officielle.
  const samba = detection.candidates.find((c) => c.label === 'Samba');
  assert.equal(samba?.mpm, 52);
  const rumba = detection.candidates.find((c) => c.label === 'Rumba');
  assert.equal(rumba?.mpm, 26);

  // 128 BPM : Cha-cha (115-140) et Tango (115-140), plages identiques.
  const chachaTango = detectStyleFromTempo(128);
  assert.equal(chachaTango.best, null);
  const labels2 = chachaTango.candidates.map((c) => c.label);
  assert.ok(labels2.includes('Cha-cha'));
  assert.ok(labels2.includes('Tango'));
});

test('detectStyleFromTempo — tempo nul ou hors plages : aucune candidate', () => {
  assert.deepEqual(detectStyleFromTempo(0), { best: null, candidates: [] });
});
