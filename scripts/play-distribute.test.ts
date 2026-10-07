/**
 * Tests des fonctions pures de `play-distribute`.
 *
 * Autonome a dessein, comme `testflight-distribute.test.ts` : la config Jest
 * racine n'orchestre que `apps/backend` et `apps/client`. Il tourne avec `tsx`,
 * via `pnpm play:distribute:test`.
 *
 * Les appels a l'API Google Play ne sont pas testes : les mocker ne verifierait
 * rien de reel.
 */

import assert from 'assert';

import {
  describeGoogleError,
  findRelease,
  isFatalPlayError,
  normalizeNotes,
  parseFlags,
  PLAY_NOTES_MAX,
  type PlayTrack,
  withNotes,
} from './play-distribute';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${(error as Error).message}`);
  }
}

const track: PlayTrack = {
  track: 'alpha',
  releases: [
    { name: '11', versionCodes: ['11'], status: 'completed' },
    {
      name: '12',
      versionCodes: ['12'],
      status: 'completed',
      releaseNotes: [
        { language: 'en-US', text: 'English notes' },
        { language: 'fr-FR', text: 'Anciennes notes' },
      ],
    },
  ],
};

test('parseFlags : valeurs par defaut', () => {
  const options = parseFlags(['--version-code', '12']);
  assert.strictEqual(options.versionCode, '12');
  assert.strictEqual(options.track, 'alpha');
  assert.strictEqual(options.language, 'fr-FR');
  assert.strictEqual(options.timeoutMin, 30);
  assert.strictEqual(options.dryRun, false);
});

test('parseFlags : options explicites', () => {
  const options = parseFlags([
    '--version-code',
    '12',
    '--track',
    'beta',
    '--notes-file',
    'n.txt',
    '--timeout',
    '5',
    '--dry-run',
  ]);
  assert.deepStrictEqual(
    [options.track, options.notesFile, options.timeoutMin, options.dryRun],
    ['beta', 'n.txt', 5, true],
  );
});

test('parseFlags : versionCode obligatoire et numerique', () => {
  assert.throws(() => parseFlags([]), /--version-code/);
  assert.throws(() => parseFlags(['--version-code', '1.0']), /--version-code/);
  assert.throws(() => parseFlags(['--version-code', '12', '--timeout', '0']), /--timeout/);
  assert.throws(() => parseFlags(['--version-code', '12', '--bidon']), /inconnue/);
});

test('findRelease : la release qui porte le versionCode', () => {
  assert.strictEqual(findRelease(track, '12')?.name, '12');
  assert.strictEqual(findRelease(track, '13'), null);
  assert.strictEqual(findRelease({ track: 'alpha' }, '12'), null);
});

test('withNotes : remplace la langue visee, garde les autres et les autres releases', () => {
  const updated = withNotes(track, '12', 'fr-FR', 'Nouvelles notes');
  const release = findRelease(updated, '12');
  assert.deepStrictEqual(release?.releaseNotes, [
    { language: 'en-US', text: 'English notes' },
    { language: 'fr-FR', text: 'Nouvelles notes' },
  ]);
  assert.strictEqual(release?.status, 'completed');
  assert.deepStrictEqual(findRelease(updated, '11'), track.releases?.[0]);
});

test('withNotes : ajoute la langue si absente', () => {
  const release = findRelease(withNotes(track, '11', 'fr-FR', 'Notes'), '11');
  assert.deepStrictEqual(release?.releaseNotes, [{ language: 'fr-FR', text: 'Notes' }]);
});

test('normalizeNotes : sous la limite, inchange (hors espaces)', () => {
  assert.strictEqual(normalizeNotes('  Nouveautés\n• A  \n'), 'Nouveautés\n• A');
});

test('normalizeNotes : coupe a une fin de ligne et marque la coupure', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `• Changement numero ${i}`);
  const notes = normalizeNotes(lines.join('\n'));
  assert.ok(notes.length <= PLAY_NOTES_MAX, `${notes.length} > ${PLAY_NOTES_MAX}`);
  assert.ok(notes.endsWith('\n…'));
  const body = notes.slice(0, -2).split('\n');
  assert.ok(
    body.every((line) => lines.includes(line)),
    'une ligne a ete coupee au milieu',
  );
});

test('normalizeNotes : une seule ligne trop longue est tronquee', () => {
  const notes = normalizeNotes('x'.repeat(900));
  assert.ok(notes.length <= PLAY_NOTES_MAX);
  assert.ok(notes.endsWith('\n…'));
});

test('describeGoogleError : extrait error.status/message et borne la longueur', () => {
  const body = JSON.stringify({
    error: { status: 'PERMISSION_DENIED', message: 'Pas les droits' },
  });
  assert.strictEqual(describeGoogleError(body), 'PERMISSION_DENIED — Pas les droits');
  assert.strictEqual(describeGoogleError('pas du json'), 'pas du json');
  assert.strictEqual(describeGoogleError('x'.repeat(900)).length, 500);
});

test('normalizeNotes : ne coupe jamais une paire UTF-16 (emoji)', () => {
  const notes = normalizeNotes('é'.repeat(300) + '🎉'.repeat(300));
  assert.ok(notes.length <= PLAY_NOTES_MAX, `${notes.length}`);
  assert.doesNotThrow(() => encodeURIComponent(notes), 'paire UTF-16 orpheline');
});

test('isFatalPlayError : droits et cle = definitif, 429/5xx/reseau = passager', () => {
  assert.ok(isFatalPlayError('Play GET /edits/1/tracks/alpha → 403: PERMISSION_DENIED'));
  assert.ok(isFatalPlayError('Play POST /edits → 404: NOT_FOUND'));
  assert.ok(isFatalPlayError('Jeton Google refuse → 400: invalid_grant'));
  assert.ok(!isFatalPlayError('Play POST /edits → 429: RESOURCE_EXHAUSTED'));
  assert.ok(!isFatalPlayError('Play POST /edits → 503: UNAVAILABLE'));
  assert.ok(!isFatalPlayError('fetch failed'));
});

console.log(failures === 0 ? '\n✓ tous les tests passent\n' : `\n✗ ${failures} test(s) en echec\n`);
process.exit(failures === 0 ? 0 : 1);
