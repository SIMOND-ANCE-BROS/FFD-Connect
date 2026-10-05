/**
 * Tests des fonctions pures de `submit-beta`.
 *
 * Autonome a dessein, comme `deploy-dev.test.ts` : la config Jest racine
 * n'orchestre que `apps/backend` et `apps/client`, un test pose dans `scripts/`
 * n'y serait jamais execute. Il tourne avec `tsx`, via `pnpm submit:beta:test`.
 *
 * `listBuilds` et `main` ne sont pas testes : ce sont des appels de process, et
 * les mocker ne verifierait rien de reel.
 */

import assert from 'assert';

import {
  describe as describeBuild,
  parseBuilds,
  parseFlags,
  selectBuild,
  submitArgs,
  submitEnv,
  type Build,
} from './submit-beta';

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

const build = (over: Partial<Build> = {}): Build => ({
  id: 'id-1',
  status: 'FINISHED',
  profile: 'beta',
  appVersion: '1.0.0',
  buildNumber: '15',
  completedAt: '2026-10-05T08:49:34.923Z',
  commit: '7acc5e133',
  hasArtifact: true,
  ...over,
});

const easJson = (items: Record<string, unknown>[]) => JSON.stringify(items);

console.log('\nparseFlags');

test('sans argument : profil beta, interactif', () => {
  assert.deepStrictEqual(parseFlags([]), {
    profile: 'beta',
    latest: false,
    dryRun: false,
  });
});

test('--latest et --dry-run', () => {
  const o = parseFlags(['--latest', '--dry-run']);
  assert.strictEqual(o.latest, true);
  assert.strictEqual(o.dryRun, true);
});

test('--id et --profile prennent une valeur', () => {
  const o = parseFlags(['--id', 'abc', '--profile', 'preview']);
  assert.strictEqual(o.id, 'abc');
  assert.strictEqual(o.profile, 'preview');
});

test('--id et --latest sont refuses ensemble', () => {
  assert.throws(() => parseFlags(['--id', 'abc', '--latest']), /exclusifs/);
});

test('une option inconnue est refusee plutot qu ignoree', () => {
  assert.throws(() => parseFlags(['--oops']), /inconnue/);
});

console.log('\nparseBuilds');

test('ne garde que les builds termines AVEC archive', () => {
  const json = easJson([
    {
      id: 'ok',
      status: 'FINISHED',
      buildProfile: 'beta',
      artifacts: { applicationArchiveUrl: 'https://x/a.ipa' },
    },
    { id: 'en-cours', status: 'IN_PROGRESS', artifacts: {} },
    // Termine mais archive expiree (30 jours) : l'envoi echouerait.
    { id: 'expire', status: 'FINISHED', artifacts: {} },
    { id: 'echoue', status: 'ERRORED', artifacts: {} },
  ]);
  assert.deepStrictEqual(
    parseBuilds(json).map((b) => b.id),
    ['ok'],
  );
});

test('extrait les champs utiles a l affichage', () => {
  const json = easJson([
    {
      id: 'x',
      status: 'FINISHED',
      buildProfile: 'beta',
      appVersion: '1.0.0',
      appBuildVersion: '15',
      gitCommitHash: '7acc5e133881b2e2939eed8ec5ae9f3a4e4b3912',
      artifacts: { applicationArchiveUrl: 'https://x/a.ipa' },
    },
  ]);
  const [b] = parseBuilds(json);
  assert.strictEqual(b.buildNumber, '15');
  assert.strictEqual(b.commit, '7acc5e133');
});

test('JSON invalide : message clair, pas un crash', () => {
  assert.throws(() => parseBuilds('pas du json'), /illisible/);
});

test('liste vide : tableau vide, pas une erreur', () => {
  assert.deepStrictEqual(parseBuilds('[]'), []);
});

console.log('\nselectBuild');

test('aucun build envoyable : erreur explicite', () => {
  assert.throws(() => selectBuild([], { latest: true }), /Aucun build/);
});

test('--latest prend le premier (EAS liste du plus recent au plus ancien)', () => {
  const a = build({ id: 'recent' });
  const b = build({ id: 'vieux' });
  const picked = selectBuild([a, b], { latest: true });
  if (picked === 'ask') throw new Error('attendu un build');
  assert.strictEqual(picked.id, 'recent');
});

test('un seul build : pas de question inutile', () => {
  const only = build({ id: 'seul' });
  const picked = selectBuild([only], {});
  assert.notStrictEqual(picked, 'ask');
  if (picked === 'ask') throw new Error('attendu un build, pas une question');
  assert.strictEqual(picked.id, 'seul');
});

test('plusieurs builds sans drapeau : on demande', () => {
  assert.strictEqual(selectBuild([build(), build({ id: 'b' })], {}), 'ask');
});

test('--id inconnu : erreur nommant l identifiant', () => {
  assert.throws(() => selectBuild([build()], { id: 'absent' }), /absent/);
});

console.log('\nsubmitEnv / submitArgs');

test('APP_ENV suit TOUJOURS le profil', () => {
  // Le piege du 2026-10-05 : sans ca, app.config.js retombe sur la variante
  // `development` et la CLI cherche les credentials de fr.ffdanse.connect.dev.
  assert.deepStrictEqual(submitEnv('beta'), { EXPO_PUBLIC_APP_ENV: 'beta' });
  assert.deepStrictEqual(submitEnv('preview'), {
    EXPO_PUBLIC_APP_ENV: 'preview',
  });
});

test('--profile est toujours passe a eas submit', () => {
  // Sans lui, le profil de soumission par defaut est `production`, qui n'a pas
  // d ascAppId configure.
  const args = submitArgs('beta', 'id-9');
  assert.ok(args.includes('--profile') && args.includes('beta'));
  assert.ok(args.includes('--id') && args.includes('id-9'));
});

console.log('\ndescribe');

test('affiche numero, version et commit', () => {
  const line = describeBuild(build());
  assert.ok(line.includes('build 15'));
  assert.ok(line.includes('1.0.0'));
  assert.ok(line.includes('7acc5e133'));
});

test('date absente : pas de "Invalid Date"', () => {
  const line = describeBuild(build({ completedAt: '' }));
  assert.ok(line.includes('date inconnue'));
  assert.ok(!line.includes('Invalid'));
});

console.log(failures === 0 ? '\n✓ tous les tests passent\n' : `\n✗ ${failures} test(s) en echec\n`);
process.exit(failures === 0 ? 0 : 1);
