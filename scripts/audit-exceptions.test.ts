/**
 * Tests du mécanisme d'exceptions de la porte d'audit.
 *
 * Autonome à dessein: la config Jest racine n'orchestre que les projets
 * `apps/backend` et `apps/client`, un test posé dans `scripts/` n'y serait
 * jamais exécuté. Il tourne donc avec le même `tsx` que `audit:dependencies`,
 * via `pnpm audit:exceptions:test`, et il est câblé dans le workflow nightly.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  EXCEPTIONS_FILE,
  daysUntilExpiry,
  isActive,
  partitionVulnerabilities,
  readExceptions,
  type AuditException,
} from './audit-exceptions';

const NOW = new Date('2026-08-29T12:00:00Z');

const vuln = (name: string, id: string, severity = 'high') => ({ name, id, severity });

const exception = (over: Partial<AuditException> = {}): AuditException => ({
  id: 'GHSA-5p2g-fcmc-qvqq',
  package: 'image-size',
  expires: '2026-11-27',
  reason: 'Aucun correctif amont.',
  ...over,
});

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

function withExceptionsFile(content: string, fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exc-'));
  try {
    fs.writeFileSync(path.join(dir, EXCEPTIONS_FILE), content, 'utf-8');
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nExceptions d'audit — comportement de la porte\n");

// --- La régression que ce mécanisme corrige ---------------------------------

test('un avis sans correctif amont ne bloque plus la porte', () => {
  const r = partitionVulnerabilities(
    [vuln('image-size', 'GHSA-5p2g-fcmc-qvqq')],
    [exception()],
    NOW,
  );
  assert.strictEqual(r.blocking.length, 0, 'la porte devrait passer');
  assert.strictEqual(r.suppressed.length, 1);
});

test('sans exception, le meme avis bloque toujours', () => {
  const r = partitionVulnerabilities([vuln('image-size', 'GHSA-5p2g-fcmc-qvqq')], [], NOW);
  assert.strictEqual(r.blocking.length, 1, 'sans exception la porte doit echouer');
});

// --- Ce que l'exception ne doit PAS pouvoir faire ---------------------------

test('une exception ne couvre pas les autres avis du meme paquet', () => {
  const r = partitionVulnerabilities(
    [vuln('image-size', 'GHSA-5p2g-fcmc-qvqq'), vuln('image-size', 'GHSA-w3rx-r6r6-pgpr')],
    [exception()],
    NOW,
  );
  assert.strictEqual(r.blocking.length, 1);
  assert.strictEqual(r.blocking[0].id, 'GHSA-w3rx-r6r6-pgpr');
});

test('un bon id sur le mauvais paquet ne suppresse rien', () => {
  const r = partitionVulnerabilities(
    [vuln('sharp', 'GHSA-5p2g-fcmc-qvqq')],
    [exception({ package: 'image-size' })],
    NOW,
  );
  assert.strictEqual(r.blocking.length, 1, 'le paquet fait partie de la cle de correspondance');
});

test('une exception ne cache jamais un avis non couvert', () => {
  const r = partitionVulnerabilities(
    [vuln('image-size', 'GHSA-5p2g-fcmc-qvqq'), vuln('fast-uri', 'GHSA-4c8g-83qw-93j6')],
    [exception()],
    NOW,
  );
  assert.strictEqual(r.blocking.length, 1);
  assert.strictEqual(r.blocking[0].name, 'fast-uri');
});

test('la detection est conservee: l avis supprime reste dans le resultat', () => {
  const r = partitionVulnerabilities(
    [vuln('image-size', 'GHSA-5p2g-fcmc-qvqq')],
    [exception()],
    NOW,
  );
  assert.strictEqual(r.suppressed[0].vulnerability.name, 'image-size');
  assert.strictEqual(r.suppressed[0].exception.reason, 'Aucun correctif amont.');
});

// --- Peremption -------------------------------------------------------------

test('une exception expiree ne suppresse plus, et est signalee', () => {
  const past = exception({ expires: '2026-08-28' });
  const r = partitionVulnerabilities([vuln('image-size', 'GHSA-5p2g-fcmc-qvqq')], [past], NOW);
  assert.strictEqual(r.blocking.length, 1, 'expiree = redevenue bloquante');
  assert.strictEqual(r.expired.length, 1);
});

test('une exception est valable jusqu a la fin de son jour d expiration', () => {
  assert.strictEqual(isActive(exception({ expires: '2026-08-29' }), NOW), true);
  assert.strictEqual(isActive(exception({ expires: '2026-08-28' }), NOW), false);
});

test('l echeance proche est annoncee avant de mordre', () => {
  const r = partitionVulnerabilities(
    [vuln('image-size', 'GHSA-5p2g-fcmc-qvqq')],
    [exception({ expires: '2026-09-05' })],
    NOW,
  );
  assert.strictEqual(r.expiringSoon.length, 1);
  assert.strictEqual(r.blocking.length, 0, 'annoncer n est pas bloquer');
  assert.strictEqual(daysUntilExpiry(exception({ expires: '2026-09-05' }), NOW), 7);
});

// --- Le temoin orphelin -----------------------------------------------------

test('une exception qui ne garde plus rien est signalee orpheline', () => {
  const r = partitionVulnerabilities([vuln('fast-uri', 'GHSA-4c8g-83qw-93j6')], [exception()], NOW);
  assert.strictEqual(r.orphans.length, 1, 'l avis a disparu: la ligne doit se voir');
  assert.strictEqual(r.expired.length, 0, 'orpheline n est pas expiree');
});

test('une exception expiree ET sans avis est orpheline, pas expiree', () => {
  const r = partitionVulnerabilities([], [exception({ expires: '2020-01-01' })], NOW);
  assert.strictEqual(r.orphans.length, 1);
  assert.strictEqual(r.expired.length, 0, 'on ne crie pas deux fois pour la meme ligne morte');
});

// --- Lecture du fichier: fail-closed ---------------------------------------

test('fichier absent = aucune exception, pas une erreur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exc-'));
  try {
    assert.deepStrictEqual(readExceptions(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('JSON illisible = erreur, jamais un silence', () => {
  withExceptionsFile('{ pas du json', (dir) => {
    assert.throws(() => readExceptions(dir), /JSON illisible/);
  });
});

test('exception sans date = fichier rejete', () => {
  withExceptionsFile(
    JSON.stringify({ exceptions: [{ id: 'GHSA-x', package: 'p', reason: 'r' }] }),
    (dir) => assert.throws(() => readExceptions(dir), /expires est obligatoire/),
  );
});

test('exception sans raison = fichier rejete', () => {
  withExceptionsFile(
    JSON.stringify({
      exceptions: [{ id: 'GHSA-x', package: 'p', expires: '2026-12-01', reason: '  ' }],
    }),
    (dir) => assert.throws(() => readExceptions(dir), /reason est obligatoire/),
  );
});

test('date inexistante = fichier rejete', () => {
  withExceptionsFile(
    JSON.stringify({
      exceptions: [{ id: 'GHSA-x', package: 'p', expires: '2026-02-30', reason: 'r' }],
    }),
    (dir) => assert.throws(() => readExceptions(dir), /n'est pas une date ISO valide/),
  );
});

test('date au mauvais format = fichier rejete', () => {
  withExceptionsFile(
    JSON.stringify({
      exceptions: [{ id: 'GHSA-x', package: 'p', expires: '01/12/2026', reason: 'r' }],
    }),
    (dir) => assert.throws(() => readExceptions(dir), /n'est pas une date ISO valide/),
  );
});

test('le fichier reel du depot est valide et complet', () => {
  const repoRoot = path.join(__dirname, '..');
  const parsed = readExceptions(repoRoot);
  for (const e of parsed) {
    assert.ok(e.reason.length > 20, `raison trop courte pour ${e.id}: une exception se justifie`);
    assert.ok(/^GHSA-|^CVE-/.test(e.id), `id inattendu: ${e.id}`);
  }
});

console.log(
  failures === 0 ? '\n✅ Tous les tests passent\n' : `\n❌ ${failures} test(s) en echec\n`,
);
process.exit(failures === 0 ? 0 : 1);
