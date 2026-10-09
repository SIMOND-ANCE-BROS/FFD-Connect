import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDocs,
  audienceForPath,
  renderIndex,
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
        'docs/utilisateurs/nouveau-parcours.md',
        'docs/archives/old.md',
        'docs/legal/cgu.md',
      ];
      for (const path of extras) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), '# A guide\n\nHello');
      }
      const docs = collectDocs(root);
      expect(docs.some((d) => d.slug === 'guides/new')).toBe(true);
      const added = docs.find((d) => d.slug === 'utilisateurs/nouveau-parcours');
      expect(added).toBeDefined();
      expect(audienceForPath(added!.path)).toBe('utilisateurs');
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
        base + 'documentation/technique/?q=docs%2Fguides#articles',
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

const userGuide: Doc = {
  path: 'docs/utilisateurs/danseurs.md',
  slug: 'utilisateurs/danseurs',
  title: 'Mon parcours danseur',
  markdown: '# Mon parcours danseur\n\n## Licence\nVoici les étapes.',
};
it('keeps audience directories and article navigation separate', () => {
  const docs = [one, userGuide];
  for (const base of ['/', '/FFD-Connect/']) {
    const userIndex = renderIndex(docs, base, 'utilisateurs');
    const technicalIndex = renderIndex(docs, base, 'technique');
    expect(userIndex).toContain('Mon parcours danseur');
    expect(userIndex).not.toContain('>First<');
    expect(technicalIndex).toContain('>First<');
    expect(technicalIndex).not.toContain('Mon parcours danseur');
    const hub = renderIndex(docs, base);
    expect(hub).toContain(base + 'documentation/utilisateurs/');
    expect(hub).toContain(base + 'documentation/technique/');
    expect(hub).not.toContain('data-doc-search');
    const userPage = renderArticle(userGuide, docs, base);
    expect(userPage).toContain(base + 'documentation/utilisateurs/#articles');
    expect(userPage).not.toContain(base + 'documentation/architecture/');
    expect(rewriteLink('./', userGuide.path, docs, base)).toBe(
      base + 'documentation/utilisateurs/?q=docs%2Futilisateurs#articles',
    );
    expect(rewriteLink('../guides/first.md', userGuide.path, docs, base)).toBe(
      base + 'documentation/guides/first/',
    );
  }
});
