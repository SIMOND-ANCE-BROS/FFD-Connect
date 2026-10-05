import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateMpm, canonicalStyleLabel, normalizeStyle } from '../src/mpm.js';

test('calculateMpm — valeurs de référence par danse (mêmes attendus que le backend)', () => {
  assert.equal(calculateMpm(104, 'Samba'), 52);
  assert.equal(calculateMpm(124, 'Cha-cha'), 31);
  assert.equal(calculateMpm(104, 'Rumba'), 26);
  assert.equal(calculateMpm(120, 'Paso Doble'), 60);
  assert.equal(calculateMpm(172, 'Jive'), 43);
  assert.equal(calculateMpm(87, 'Valse Lente'), 29);
  assert.equal(calculateMpm(128, 'Tango'), 32);
  assert.equal(calculateMpm(174, 'Valse Viennoise'), 58);
  assert.equal(calculateMpm(116, 'Slow Fox'), 29);
  assert.equal(calculateMpm(200, 'Quickstep'), 50);
});

test("calculateMpm — correction d'octave (music-tempo double ou divise le tempo)", () => {
  assert.equal(calculateMpm(208, 'Samba'), 52); // détecté à 2× → recalé à 104
  assert.equal(calculateMpm(52, 'Samba'), 52); // détecté à ÷2 → recalé à 104
  assert.equal(calculateMpm(43.5, 'Valse Viennoise'), 58); // ÷4 → 174
});

test('calculateMpm — style inconnu ou catégorie : BPM brut arrondi', () => {
  assert.equal(calculateMpm(123.4, 'LATIN'), 123);
  assert.equal(calculateMpm(123.6, undefined), 124);
  assert.equal(calculateMpm(0, 'Samba'), 0);
});

test('normalizeStyle — synonymes usuels', () => {
  assert.equal(normalizeStyle('CHA CHA'), 'cha-cha');
  assert.equal(normalizeStyle('foxtrot'), 'slow fox');
  assert.equal(normalizeStyle('valse rapide'), 'viennoise');
  assert.equal(normalizeStyle('waltz'), 'valse lente');
  assert.equal(normalizeStyle('STANDARD'), null);
});

test('canonicalStyleLabel — libellés du DTO backend', () => {
  assert.equal(canonicalStyleLabel('chacha'), 'Cha-cha');
  assert.equal(canonicalStyleLabel('paso'), 'Paso Doble');
  assert.equal(canonicalStyleLabel('viennese waltz'), 'Valse Viennoise');
  assert.equal(canonicalStyleLabel('techno'), null);
});
