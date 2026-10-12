/**
 * Tests de `tester-notes.mjs` (node:test, sans dépendance) :
 *   pnpm tester-notes:test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractTesterSection,
  prNumber,
  renderTesterNotes,
  sanitizeStoreText,
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
  assert.deepEqual(toBullets('- Nouveau 🎵 lecteur\n- Rien'), ['• Nouveau  lecteur']);
  const out = renderTesterNotes([extractTesterSection(FOOTER_BODY), '- Rien', '- Ok 🤖']);
  assert.equal(
    out,
    'Nouveautés et corrections\n• Toucher une notification ouvre l’écran concerné.\n• Ok',
  );
  assert.ok(!/🤖|claude|Generated/i.test(out));
  assert.equal(renderTesterNotes(['- Rien']), 'Corrections et améliorations diverses.');
});
