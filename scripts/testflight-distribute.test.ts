/**
 * Tests des fonctions pures de `testflight-distribute`.
 *
 * Autonome a dessein, comme `submit-beta.test.ts` : la config Jest racine
 * n'orchestre que `apps/backend` et `apps/client`. Il tourne avec `tsx`, via
 * `pnpm testflight:distribute:test`.
 *
 * Les appels a l'API App Store Connect ne sont pas testes : les mocker ne
 * verifierait rien de reel.
 */

import assert from 'assert';

import {
  addToGroupBody,
  findBuild,
  findGroupId,
  normalizeNotes,
  parseFlags,
  processingVerdict,
  reviewSubmissionBody,
} from './testflight-distribute';

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

const builds = (...items: { id: string; version: string; processingState?: string }[]) => ({
  data: items.map(({ id, version, processingState }) => ({
    type: 'builds',
    id,
    attributes: { version, processingState },
  })),
});

test('parseFlags : valeurs par defaut', () => {
  const options = parseFlags(['--build-number', '17']);
  assert.deepStrictEqual(options, {
    buildNumber: '17',
    group: 'Beta FFD',
    locale: 'fr-FR',
    timeoutMin: 60,
    dryRun: false,
  });
});

test('parseFlags : toutes les options', () => {
  const options = parseFlags([
    '--build-number',
    '18',
    '--group',
    'Autre groupe',
    '--notes-file',
    'notes.txt',
    '--locale',
    'en-US',
    '--timeout',
    '30',
    '--dry-run',
  ]);
  assert.strictEqual(options.group, 'Autre groupe');
  assert.strictEqual(options.notesFile, 'notes.txt');
  assert.strictEqual(options.locale, 'en-US');
  assert.strictEqual(options.timeoutMin, 30);
  assert.strictEqual(options.dryRun, true);
});

test('parseFlags : --build-number obligatoire et numerique', () => {
  assert.throws(() => parseFlags([]), /build-number/);
  assert.throws(() => parseFlags(['--build-number', '1.0.0']), /build-number/);
});

test('parseFlags : option sans valeur ou inconnue', () => {
  assert.throws(() => parseFlags(['--build-number']), /attend une valeur/);
  assert.throws(() => parseFlags(['--build-number', '17', '--force']), /inconnue/);
});

test('parseFlags : timeout invalide', () => {
  assert.throws(() => parseFlags(['--build-number', '17', '--timeout', '0']), /timeout/);
  assert.throws(() => parseFlags(['--build-number', '17', '--timeout', 'abc']), /timeout/);
});

test('findBuild : retrouve le bon numero parmi plusieurs', () => {
  const build = findBuild(
    builds(
      { id: 'a', version: '16', processingState: 'VALID' },
      { id: 'b', version: '17', processingState: 'PROCESSING' },
    ),
    '17',
  );
  assert.deepStrictEqual(build, { id: 'b', version: '17', processingState: 'PROCESSING' });
});

test('findBuild : absent ou reponse inattendue → null', () => {
  assert.strictEqual(findBuild(builds({ id: 'a', version: '16' }), '17'), null);
  assert.strictEqual(findBuild({ errors: [] }, '17'), null);
  assert.strictEqual(findBuild(null, '17'), null);
});

test('processingVerdict : etats Apple', () => {
  const b = (processingState: string) => ({ id: 'x', version: '17', processingState });
  assert.strictEqual(processingVerdict(null), 'wait');
  assert.strictEqual(processingVerdict(b('PROCESSING')), 'wait');
  assert.strictEqual(processingVerdict(b('UNKNOWN')), 'wait');
  assert.strictEqual(processingVerdict(b('VALID')), 'ready');
  assert.strictEqual(processingVerdict(b('FAILED')), 'fail');
  assert.strictEqual(processingVerdict(b('INVALID')), 'fail');
});

test('findGroupId : correspondance exacte du nom', () => {
  const groups = {
    data: [
      { id: 'g1', attributes: { name: 'Interne' } },
      { id: 'g2', attributes: { name: 'Beta FFD' } },
    ],
  };
  assert.strictEqual(findGroupId(groups, 'Beta FFD'), 'g2');
  assert.strictEqual(findGroupId(groups, 'beta ffd'), null);
  assert.strictEqual(findGroupId({}, 'Beta FFD'), null);
});

test('normalizeNotes : trim et limite de 4000 caracteres', () => {
  assert.strictEqual(normalizeNotes('  notes \n'), 'notes');
  assert.strictEqual(normalizeNotes('x'.repeat(5000)).length, 4000);
});

test('corps JSON:API envoyes a App Store Connect', () => {
  assert.deepStrictEqual(addToGroupBody('b1'), { data: [{ type: 'builds', id: 'b1' }] });
  assert.deepStrictEqual(reviewSubmissionBody('b1'), {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: 'b1' } } },
    },
  });
});

console.log(failures === 0 ? '\n✓ tous les tests passent\n' : `\n✗ ${failures} test(s) en echec\n`);
process.exit(failures === 0 ? 0 : 1);
