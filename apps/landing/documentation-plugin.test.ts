import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDocs,
  renderArticle,
  renderMarkdown,
  rewriteLink,
  type Doc,
} from './documentation-plugin';
const one: Doc = {
  path: 'docs/guides/first.md',
  slug: 'guides/first',
  title: 'First',
  markdown: '# First\n\n## Début\nDu texte.',
};
const two: Doc = {
  path: 'docs/guides/new.md',
  slug: 'guides/new',
  title: 'New',
  markdown: '# New',
};
describe('repository-backed static documentation', () => {
  it('discovers newly added Markdown without a manual route list and excludes archives', () => {
    const root = mkdtempSync(join(tmpdir(), 'ffd-docs-'));
    try {
      const extras = [
        'README.md',
        'CONTRIBUTING.md',
        'KNOWN_ISSUES.md',
        'apps/client/README.md',
        'apps/client/UPGRADES.md',
        'apps/client/firebase/README.md',
        'scripts/README.md',
        'patches/PATCHES.md',
        'docs/README.md',
        'docs/guides/new.md',
        'docs/archives/old.md',
        'docs/legal/cgu.md',
      ];
      for (const path of extras) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), '# A guide\n\nHello');
      }
      const docs = collectDocs(root);
      expect(docs.some((d) => d.slug === 'guides/new')).toBe(true);
      expect(docs.some((d) => d.path.includes('archives'))).toBe(false);
      expect(docs.some((d) => d.path.includes('legal'))).toBe(false);
      mkdirSync(join(root, 'docs/new-folder'));
      writeFileSync(join(root, 'docs/new-folder/README.md'), '# New section');
      expect(collectDocs(root).some((d) => d.slug === 'new-folder')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('keeps document and legal links local at both hosting base paths', () => {
    for (const base of ['/', '/FFD-Connect/']) {
      expect(rewriteLink('./new.md#hello', one.path, [one, two], base)).toBe(
        base + 'documentation/guides/new/#hello',
      );
      expect(rewriteLink('../legal/cgu.md', one.path, [one, two], base)).toBe(base + 'cgu/');
      expect(rewriteLink('./', one.path, [one, two], base)).toBe(
        base + 'documentation/?q=docs%2Fguides#articles',
      );
    }
  });
  it('renders useful content without client JavaScript and disambiguates headings', () => {
    const doc = {
      ...one,
      markdown:
        '# First\n\n## Début\n\n## Début\n\n| A | B |\n| - | - |\n| Hello | World |\n\n```ts\nconst x = 1;\n```',
    };
    const page = renderArticle(doc, [doc], '/');
    expect(page).toContain('<table>');
    expect(page).toContain('const x = 1;');
    expect(page).toContain('id="début-1"');
    expect(page).toContain('href="#début-1"');
    expect(page).not.toContain('/api/documentation');
  });
  it('does not execute raw HTML or unsafe Markdown links', () => {
    const { html } = renderMarkdown(
      {
        ...one,
        markdown:
          '# First\n\n<script>alert(1)</script>\n\n[link](javascript:alert%281%29)\n\n![x](data:text/html,malicious)',
      },
      [one],
      '/',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="data:');
  });
});
