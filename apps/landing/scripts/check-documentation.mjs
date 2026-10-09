/* global console */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const docs = JSON.parse(readFileSync(resolve(root, 'documentation/manifest.json'), 'utf8'));
assert(docs.length > 0, 'Documentation manifest must contain articles');
for (const doc of docs) {
  const html = readFileSync(resolve(root, 'documentation', doc.slug, 'index.html'), 'utf8');
  assert(html.includes('class="doc-prose"'), doc.slug + ' has no rendered article');
  assert(
    !html.includes('<!--documentation-content-->'),
    doc.slug + ' retained its template placeholder',
  );
  const assets = [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)].map((m) => m[1]);
  assert(
    assets.some((p) => p.endsWith('.css')),
    doc.slug + ' has no styles',
  );
  for (const asset of assets) {
    const index = asset.indexOf('/assets/');
    if (index >= 0) assert(existsSync(resolve(root, asset.slice(index + 1))), asset + ' missing');
  }
}
for (const audience of ['utilisateurs', 'technique']) {
  const html = readFileSync(resolve(root, 'documentation', audience, 'index.html'), 'utf8');
  assert(html.includes('data-doc-search'), audience + ' directory must be searchable');
  const listed = [...html.matchAll(/data-doc-audience="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(listed.length, docs.filter((doc) => doc.audience === audience).length);
  assert(
    listed.every((value) => value === audience),
    'Audience directories must not mix articles',
  );
}
for (const path of [
  'beta',
  'confidentialite',
  'cgu',
  'mentions-legales',
  'suppression-compte',
  'reset-password',
])
  assert(existsSync(resolve(root, path, 'index.html')), path + ' must remain available');
console.log(
  `Validated ${docs.length} static articles, their assets and all preserved entry points.`,
);
