import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trackSignature } from '../src/dedupe.js';

test('trackSignature — insensible à la casse, aux accents et à la ponctuation', () => {
  assert.equal(trackSignature('Michael Bublé', 'Sway'), trackSignature('michael buble', 'SWAY!'));
});

test('trackSignature — ignore les suffixes de plateforme et les feat.', () => {
  assert.equal(
    trackSignature('Dean Martin', 'Sway (Official Video)'),
    trackSignature('Dean Martin', 'Sway'),
  );
  assert.equal(
    trackSignature('Dean Martin', 'Sway [Remastered 2004]'),
    trackSignature('Dean Martin', 'Sway'),
  );
  assert.equal(
    trackSignature('Shakira feat. Wyclef Jean', 'Hips Don’t Lie'),
    trackSignature('Shakira', 'Hips Dont Lie'),
  );
});

test('trackSignature — deux titres différents ne se rapprochent pas', () => {
  assert.notEqual(trackSignature('Artist', 'Sway'), trackSignature('Artist', 'Tango'));
  assert.notEqual(trackSignature('Artist A', 'Sway'), trackSignature('Artist B', 'Sway'));
});

test('trackSignature — artiste inconnu : marqué "?", ne matche pas un artiste identifié', () => {
  assert.equal(trackSignature('Unknown', 'Sway'), trackSignature('', 'Sway'));
  assert.notEqual(trackSignature('Unknown', 'Sway'), trackSignature('Dean Martin', 'Sway'));
});
