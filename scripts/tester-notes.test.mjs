/**
 * Tests de `tester-notes.mjs` (node:test, sans dépendance) :
 *   pnpm tester-notes:test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractTesterSection,
  isNothing,
  MORE,
  parseToTest,
  prNumber,
  renderTesterNotes,
  sanitizeStoreText,
  STORE_LIMITS,
  toBullets,
} from './tester-notes.mjs';

const TEMPLATE_ONLY = `## Summary

- Fix the thing

## Pour les testeurs

<!-- En français, pour un testeur. -->

## Test plan

- [ ] CI`;

test('prNumber : dernière réf (#N) du sujet, null sinon', () => {
  assert.equal(prNumber('feat(notifications): wire pushes (#38) (#125)'), 125);
  assert.equal(prNumber('fix(client): tap opens the screen (#130)'), 130);
  assert.equal(prNumber('chore: no reference'), null);
});

test('extractTesterSection : section présente, jusqu’à la section suivante', () => {
  const body = `## Summary\n\nx\n\n## Pour les testeurs\n\nToucher une notification ouvre l'écran concerné.\n\n## Test plan\n\n- [ ] y`;
  assert.equal(extractTesterSection(body), "Toucher une notification ouvre l'écran concerné.");
});

test('extractTesterSection : titre insensible à la casse, sous-titres ### conservés', () => {
  const body = `## pour les TESTEURS\nA\n### Détail\nB`;
  assert.equal(extractTesterSection(body), 'A\n### Détail\nB');
});

test('extractTesterSection : modèle non rempli, absente ou « rien » → null', () => {
  assert.equal(extractTesterSection(TEMPLATE_ONLY), null);
  assert.equal(extractTesterSection('## Summary\n- x'), null);
  assert.equal(extractTesterSection('## Pour les testeurs\nRien.'), null);
  assert.equal(extractTesterSection('## Pour les testeurs\n—'), null);
  assert.equal(extractTesterSection(''), null);
  assert.equal(extractTesterSection(null), null);
});

test('toBullets : une puce par élément de liste, sinon un paragraphe', () => {
  assert.deepEqual(toBullets('- Premier\n* Second\n• Troisième'), [
    '• Premier',
    '• Second',
    '• Troisième',
  ]);
  assert.deepEqual(toBullets('Une phrase\nsur deux lignes.'), ['• Une phrase sur deux lignes.']);
});

test('renderTesterNotes : titre + puces, repli si rien pour les testeurs', () => {
  assert.equal(renderTesterNotes(['A', '- B\n- C']), 'Nouveautés et corrections\n• A\n• B\n• C');
  assert.equal(renderTesterNotes([]), 'Corrections et améliorations diverses.');
});

const FOOTER_BODY = `## Summary

- Fix the thing

## Pour les testeurs

- Toucher une notification ouvre l’écran concerné.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ABC`;

test('extractTesterSection : s’arrête au pied de page de la PR (dernière section)', () => {
  assert.equal(
    extractTesterSection(FOOTER_BODY),
    '- Toucher une notification ouvre l’écran concerné.',
  );
  assert.equal(extractTesterSection('## Pour les testeurs\nA\n\n---\nB'), 'A');
  assert.equal(
    extractTesterSection('## Pour les testeurs\nA\nGenerated with [Claude Code](x)\nB'),
    'A',
  );
  assert.equal(extractTesterSection('## Pour les testeurs\nA\nhttps://claude.ai/code/s_1'), 'A');
});

test('extractTesterSection : « Rien » seul avant un pied de page → null', () => {
  assert.equal(
    extractTesterSection(
      '## Pour les testeurs\n\nRien\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ),
    null,
  );
  assert.equal(extractTesterSection('## Pour les testeurs\n\n- Rien.\n'), null);
  assert.equal(extractTesterSection('## Pour les testeurs\n- A\n- rien\n'), '- A');
});

test('extractTesterSection : commentaires HTML du modèle retirés', () => {
  assert.equal(extractTesterSection('## Pour les testeurs\n<!-- guide\nmulti -->\nA'), 'A');
});

test('sanitizeStoreText : retire les emoji hors BMP, garde accents et ponctuation', () => {
  assert.equal(sanitizeStoreText('A 🤖 B'), 'A  B');
  assert.equal(sanitizeStoreText('« Écran » d’accueil… • élève'), '« Écran » d’accueil… • élève');
});

test('toBullets / renderTesterNotes : emoji dans un item et items « Rien » écartés', () => {
  assert.deepEqual(toBullets('- Nouveau 🎵 lecteur\n- Rien'), ['• Nouveau lecteur']);
  const out = renderTesterNotes([extractTesterSection(FOOTER_BODY), '- Rien', '- Ok 🤖']);
  assert.equal(
    out,
    'Nouveautés et corrections\n• Toucher une notification ouvre l’écran concerné.\n• Ok',
  );
  assert.ok(!/🤖|claude|Generated/i.test(out));
  assert.equal(renderTesterNotes(['- Rien']), 'Corrections et améliorations diverses.');
});

test('isNothing : variantes de « rien » (casse, accents, ponctuation, précisions)', () => {
  for (const text of [
    'Rien',
    'rien.',
    'Rien.',
    'RIEN !',
    "Rien pour l'instant",
    'Rien pour l’instant.',
    'Rien de visible',
    'Rien de visible pour les testeurs.',
    'Rien à tester',
    'Rien a signaler',
    'Néant',
    'neant',
    'Aucun',
    'Aucune.',
    'Aucun changement visible.',
    'Pas de changement visible',
    'Pas d’effet visible côté app',
    'N/A',
    'n/a.',
    'Sans objet',
    '—',
    '- Rien',
    '• Rien pour le moment',
    'Rien (back-office admin uniquement, l’app mobile ne change pas).',
    'Rien : rien ne change encore pour les licenciés.',
    "Rien dans l'application mobile. Back-office uniquement.",
    'Rien — CI uniquement',
  ]) {
    assert.equal(isNothing(text), true, text);
  }
});

test('isNothing : un vrai contenu n’est jamais écarté', () => {
  for (const text of [
    'Rien ne change à l’écran, mais l’application démarre plus vite.',
    'Aucune régression attendue sur la lecture de musique : la vérifier.',
    'Rienne', // mot différent
    'Le bouton « Rien à déclarer » apparaît dans le profil.',
    'Pas de connexion ? Le lecteur garde les favoris hors ligne.',
    'Néanmoins, la liste des clubs se charge plus vite.',
    'Nouveau : rien à saisir pour renouveler sa licence.',
  ]) {
    assert.equal(isNothing(text), false, text);
  }
});

test('extractTesterSection : « Rien pour l’instant » et variantes → null', () => {
  assert.equal(extractTesterSection("## Pour les testeurs\n\nRien pour l'instant."), null);
  assert.equal(extractTesterSection('## Pour les testeurs\nRien de visible'), null);
  assert.equal(extractTesterSection('## Pour les testeurs\nAucun changement visible.'), null);
  assert.equal(extractTesterSection('## Pour les testeurs\n- A\n- Rien pour l’instant'), '- A');
});

test('sanitizeStoreText : retire aussi les pictogrammes du plan de base', () => {
  assert.equal(sanitizeStoreText('✨ Nouveau ⚡ rapide ✅ ⚠️ 1️⃣'), ' Nouveau  rapide   1');
  assert.equal(sanitizeStoreText('« Écran » → suivant…'), '« Écran » → suivant…');
});

test('toBullets : gras et code markdown retirés (texte brut pour les stores)', () => {
  assert.deepEqual(toBullets('- Écran **Licence** : bouton `Wallet`'), [
    '• Écran Licence : bouton Wallet',
  ]);
});

test('parseToTest : points séparés par « ; », vides et emoji retirés', () => {
  assert.deepEqual(parseToTest(' Connexion ; ; Lecteur 🎵 hors ligne;'), [
    '• Connexion',
    '• Lecteur hors ligne',
  ]);
  assert.deepEqual(parseToTest(undefined), []);
  assert.deepEqual(parseToTest(''), []);
});

test('renderTesterNotes : « À tester en priorité » en tête', () => {
  assert.equal(
    renderTesterNotes(['- B'], { toTest: ['• A'] }),
    'À tester en priorité\n• A\n\nNouveautés et corrections\n• B',
  );
  assert.equal(
    renderTesterNotes([], { toTest: ['• A'] }),
    'À tester en priorité\n• A\n\nCorrections et améliorations diverses.',
  );
});

/** Sections « longues » : n PR de 3 points d'environ 90 caractères. */
function longSections(n) {
  return Array.from({ length: n }, (_, i) =>
    [1, 2, 3]
      .map((j) => `- PR ${i} point ${j} : l’écran des compétitions affiche désormais les tours 🎉.`)
      .join('\n'),
  );
}

const EMOJI = /\p{Extended_Pictographic}|[\u{10000}-\u{10FFFF}]|\uFE0F|\u200D/u;

test('renderTesterNotes : jamais au-delà de la limite, points entiers et dans l’ordre', () => {
  const sections = longSections(40); // ~10 000 caractères sans limite
  const toTest = parseToTest('Le mode compétition ; La connexion par FaceID');
  const full = renderTesterNotes(sections, { toTest });
  assert.ok(full.length > STORE_LIMITS.ios);
  const allLines = full.split('\n');

  for (const max of [STORE_LIMITS.ios, STORE_LIMITS.android, 300, 150]) {
    const out = renderTesterNotes(sections, { toTest, maxLength: max });
    assert.ok(out.length <= max, `${out.length} > ${max}`);
    assert.ok(!EMOJI.test(out), 'emoji dans la sortie');
    assert.ok(
      out.startsWith('À tester en priorité\n• Le mode compétition\n• La connexion par FaceID'),
    );
    assert.ok(out.endsWith(`\n${MORE}`), out);
    // Chaque ligne gardée est une ligne entière de la version complète, et
    // dans le même ordre (préfixe) : aucune coupe au milieu d'un point.
    const lines = out.split('\n').slice(0, -1);
    assert.deepEqual(lines, allLines.slice(0, lines.length));
  }
  // iOS garde nettement plus de points qu'Android.
  const ios = renderTesterNotes(sections, { toTest, maxLength: STORE_LIMITS.ios });
  assert.ok(ios.length > STORE_LIMITS.ios - 120, `iOS sous-rempli : ${ios.length}`);
  assert.match(ios, /Nouveautés et corrections\n• PR 0 point 1/);
});

test('renderTesterNotes : pas de titre orphelin quand aucun point ne tient', () => {
  const toTest = parseToTest('Un point prioritaire assez long pour remplir presque tout');
  const out = renderTesterNotes(longSections(5), { toTest, maxLength: 140 });
  assert.equal(
    out,
    `À tester en priorité\n• Un point prioritaire assez long pour remplir presque tout\n\n${MORE}`,
  );
  assert.ok(!out.includes('Nouveautés'));
});

test('renderTesterNotes : « À tester » prime même s’il remplit toute la limite', () => {
  const toTest = parseToTest(`${'a'.repeat(200)} ; ${'b'.repeat(200)} ; ${'c'.repeat(200)}`);
  const out = renderTesterNotes(longSections(3), { toTest, maxLength: STORE_LIMITS.android });
  assert.ok(out.length <= STORE_LIMITS.android);
  assert.equal(out, `À tester en priorité\n• ${'a'.repeat(200)}\n• ${'b'.repeat(200)}`);
  // Un point seul plus long que la limite est coupé (« … »), jamais dépassé.
  const huge = renderTesterNotes([], { toTest: parseToTest('x'.repeat(900)), maxLength: 500 });
  assert.ok(huge.length <= 500);
  assert.ok(huge.endsWith('…'));
});

test('renderTesterNotes : sous la limite, rien n’est coupé ni ajouté', () => {
  const out = renderTesterNotes(['- A', '- B'], { maxLength: STORE_LIMITS.android });
  assert.equal(out, 'Nouveautés et corrections\n• A\n• B');
  const noToTest = renderTesterNotes(longSections(20), { maxLength: STORE_LIMITS.android });
  assert.ok(noToTest.length <= STORE_LIMITS.android);
  assert.ok(noToTest.startsWith('Nouveautés et corrections\n• PR 0 point 1'));
  assert.ok(noToTest.endsWith(MORE));
});
