import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBasename, fsSafe } from '../src/prepare.js';

/**
 * Regex de la convention fédération (utilisée par l'ancien import du
 * backend, aujourd'hui retiré). Les noms générés restent parsables par
 * cette regex : style, artiste, titre et tempo se retrouvent depuis le nom
 * de fichier seul.
 */
const FED_REGEX = /^(\d+-)?(.*?)\s*[|｜]\s*(.*?)\s*-\s*(.*?)(?:\((\d+)\s*(?:BPM|MPM)?\))?\.mp3$/i;

test('buildBasename — nom conforme à la convention fédération', () => {
  const name = `${buildBasename(1, 'Samba', 'Michael Bublé', 'Sway', { value: 52, unit: 'MPM' })}.mp3`;
  assert.equal(name, '01-SAMBA ｜ Michael Bublé - Sway (52 MPM).mp3');

  const match = name.match(FED_REGEX);
  assert.ok(match, 'le nom doit matcher la regex du backend');
  assert.equal(match[2].trim(), 'SAMBA');
  assert.equal(match[3].trim(), 'Michael Bublé');
  assert.equal(match[4].trim(), 'Sway');
  assert.equal(match[5], '52');
});

test('buildBasename — sans danse : AUTRE + BPM brut', () => {
  const name = `${buildBasename(12, null, 'Artist', 'Title', { value: 123, unit: 'BPM' })}.mp3`;
  assert.equal(name, '12-AUTRE ｜ Artist - Title (123 BPM).mp3');
  const match = name.match(FED_REGEX);
  assert.ok(match);
  assert.equal(match[5], '123');
});

test("buildBasename — tirets de l'artiste remplacés pour préserver le séparateur", () => {
  const name = `${buildBasename(3, 'Jive', 'Jean-Luc & The B-Side', 'Rock-It', { value: 43, unit: 'MPM' })}.mp3`;
  const match = name.match(FED_REGEX);
  assert.ok(match);
  // Le premier " - " du nom doit rester le séparateur artiste/titre.
  assert.equal(match[3].trim(), 'Jean–Luc & The B–Side');
  assert.equal(match[4].trim(), 'Rock–It');
});

test('buildBasename — tempo inconnu : pas de parenthèses', () => {
  const name = `${buildBasename(4, 'Tango', 'A', 'B', null)}.mp3`;
  assert.equal(name, '04-TANGO ｜ A - B.mp3');
  assert.ok(FED_REGEX.test(name));
});

test('fsSafe — retire les caractères interdits (Windows inclus)', () => {
  assert.equal(fsSafe('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
  assert.equal(fsSafe('titre avec ｜ pipe'), 'titre avec pipe');
  assert.equal(fsSafe('fin de nom.. '), 'fin de nom');
});
