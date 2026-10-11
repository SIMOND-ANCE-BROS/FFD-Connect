import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateDocumentation } from './documentation-validation';

const roots: string[] = [];
function fixture(html: string) {
  const root = mkdtempSync(join(tmpdir(), 'ffd-links-'));
  roots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('documentation/manifest.json', JSON.stringify([{ slug: 'guide' }]));
  for (const page of ['', '/utilisateurs', '/technique'])
    write('documentation' + page + '/index.html', '<main id="articles"></main>');
  write('documentation/guide/index.html', html);
  write('photo.png', 'fixture');
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
describe('documentation build gate', () => {
  it.each(['/', '/FFD-Connect/'])(
    'accepts existing pages, fragments and images under %s',
    (base) => {
      const root = fixture(
        `<h2 id="début"></h2><a href="#d%C3%A9but">Start</a><a href="${base}documentation/utilisateurs/?q=abc#articles">Index</a><img src="${base}photo.png"><a href="https://example.com/missing">External</a><code>&lt;a href="/missing"&gt;</code>`,
      );
      expect(() => validateDocumentation(root, base)).not.toThrow();
    },
  );
  it.each([
    ['page', '<a href="../missing/">Broken</a>'],
    ['fragment', '<a href="#missing">Broken</a>'],
    ['image', '<img src="/missing.png">'],
  ])('rejects a missing %s with its source page', (_name, html) => {
    expect(() => validateDocumentation(fixture(html), '/')).toThrow(
      /documentation\/guide: missing/,
    );
  });
  it('rejects a root link that escapes a project deployment', () => {
    expect(() =>
      validateDocumentation(fixture('<a href="/documentation/">Wrong base</a>'), '/FFD-Connect/'),
    ).toThrow(/escapes deployment base/);
  });
});
