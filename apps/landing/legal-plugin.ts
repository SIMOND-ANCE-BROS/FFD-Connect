import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { marked } from 'marked';
import type { Plugin } from 'vite';

/**
 * Renders docs/legal/*.md into the legal pages at build time.
 *
 * These documents are published to satisfy a legal obligation (and Apple's
 * TestFlight requirement for a reachable privacy policy), so they must not
 * depend on JavaScript executing in the reader's browser. Hence static HTML
 * rather than a React route.
 *
 * The Markdown stays in docs/legal/, which the backend already cites as the
 * reference for retention periods — this site reads it, it never forks it.
 */

const LEGAL_DIR = resolve(__dirname, '..', '..', 'docs', 'legal');

const DOCS = {
  confidentialite: { file: 'politique-confidentialite.md', label: 'Confidentialité' },
  cgu: { file: 'cgu.md', label: 'CGU' },
  'mentions-legales': { file: 'mentions-legales.md', label: 'Mentions légales' },
  'suppression-compte': { file: 'suppression-compte.md', label: 'Suppression du compte' },
} as const;

type Slug = keyof typeof DOCS;

const isSlug = (value: string): value is Slug => value in DOCS;

function renderPage(slug: Slug, base: string): string {
  const markdown = readFileSync(resolve(LEGAL_DIR, DOCS[slug].file), 'utf8');
  // Links between the documents are relative in Markdown (./cgu.md); on the
  // site they are sibling directories.
  const body = marked
    .parse(markdown, { async: false })
    .replace(/href="\.\/politique-confidentialite\.md"/g, `href="${base}confidentialite/"`)
    .replace(/href="\.\/cgu\.md"/g, `href="${base}cgu/"`)
    .replace(/href="\.\/mentions-legales\.md"/g, `href="${base}mentions-legales/"`)
    .replace(/href="\.\/suppression-compte\.md"/g, `href="${base}suppression-compte/"`);

  const nav = (Object.keys(DOCS) as Slug[])
    .map((key) => {
      const current = key === slug ? ' aria-current="page"' : '';
      return `<a href="${base}${key}/"${current}>${DOCS[key].label}</a>`;
    })
    .join('\n          ');

  return `<div class="legal">
      <header class="legal__header">
        <a class="legal__brand" href="${base}">
          <img src="${base}ffd-logo.svg" alt="" width="28" height="28" />
          <span>FFD Connect</span>
        </a>
        <nav class="legal__nav" aria-label="Documents légaux">
          ${nav}
        </nav>
      </header>
      <main class="legal__body">
        <article>
${body}
        </article>
      </main>
      <footer class="legal__footer">
        <p>Projet indépendant — non affilié à la Fédération Française de Danse</p>
        <a href="${base}">Retour à l'accueil</a>
      </footer>
    </div>`;
}

export function legalPages(): Plugin {
  let base = '/';
  return {
    name: 'ffd-legal-pages',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const slug = ctx.path.split('/').filter(Boolean)[0] ?? '';
        if (!isSlug(slug)) return html;
        return html.replace('<!--legal-content-->', renderPage(slug, base));
      },
    },
  };
}
