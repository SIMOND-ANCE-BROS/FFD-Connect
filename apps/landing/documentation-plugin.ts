import { readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { Marked, Renderer } from 'marked';
import type { Plugin } from 'vite';

export type Doc = { path: string; slug: string; title: string; markdown: string };
const repo = 'https://github.com/SIMOND-ANCE-BROS/FFD-Connect';
const excluded = new Set(['archives', 'references', 'superpowers', 'legal']);
const extras: Record<string, string> = {
  'README.md': 'demarrer',
  'CONTRIBUTING.md': 'contribuer',
  'KNOWN_ISSUES.md': 'problemes-connus',
  'apps/client/README.md': 'application',
  'apps/client/UPGRADES.md': 'application/mises-a-jour',
  'apps/client/firebase/README.md': 'application/firebase',
  'scripts/README.md': 'scripts',
  'patches/PATCHES.md': 'patches',
};
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const headingId = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
export function slugForPath(path: string) {
  return (
    extras[path] ??
    (path === 'docs/README.md'
      ? 'index'
      : path
          .replace(/^docs\//, '')
          .replace(/\.md$/, '')
          .replace(/\/README$/, ''))
  );
}
export function collectDocs(root: string): Doc[] {
  const paths = Object.keys(extras);
  function walk(dir: string) {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory() && !(dir === 'docs' && excluded.has(entry.name))) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
    }
  }
  walk('docs');
  const docs = paths.sort().map((path) => {
    const raw = readFileSync(resolve(root, path), 'utf8');
    const markdown = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const title =
      markdown.match(/^# (.+)$/m)?.[1].replace(/[*`]/g, '') ??
      path.split('/').at(-1)!.replace(/\.md$/, '').replace(/-/g, ' ');
    return { path, slug: slugForPath(path), title, markdown };
  });
  const slugs = new Set<string>();
  for (const doc of docs) {
    if (slugs.has(doc.slug)) throw new Error(`Duplicate documentation slug: ${doc.slug}`);
    slugs.add(doc.slug);
  }
  return docs;
}
export function rewriteLink(href: string, source: string, docs: Doc[], base: string) {
  if (href.startsWith('#')) return href;
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return /^(https?:|mailto:)/i.test(href) ? href : '#';
  const url = new URL(href, 'https://repository.local/' + source);
  const path = decodeURIComponent(url.pathname.slice(1));
  const legal: Record<string, string> = {
    'docs/legal/cgu.md': 'cgu/',
    'docs/legal/politique-confidentialite.md': 'confidentialite/',
    'docs/legal/mentions-legales.md': 'mentions-legales/',
    'docs/legal/suppression-compte.md': 'suppression-compte/',
  };
  if (legal[path]) return base + legal[path] + url.hash;
  const doc = docs.find(
    (d) => d.path === path || d.path === path.replace(/\/$/, '') + '/README.md',
  );
  if (doc) return base + 'documentation/' + doc.slug + '/' + url.hash;
  if (docs.some((d) => d.path.startsWith(path.replace(/\/$/, '') + '/')))
    return base + 'documentation/?q=' + encodeURIComponent(path.replace(/\/$/, '')) + '#articles';
  return repo + '/blob/staging/' + path + url.hash;
}
export function renderMarkdown(doc: Doc, docs: Doc[], base: string) {
  const toc: { title: string; id: string }[] = [];
  const ids = new Map<string, number>();
  const renderer = new Renderer();
  renderer.html = (token) => escapeHtml(token.text);
  renderer.heading = function (token) {
    const text = token.text.replace(/[*`]/g, '');
    const stem = headingId(text);
    const n = ids.get(stem) ?? 0;
    ids.set(stem, n + 1);
    const id = stem + (n ? '-' + n : '');
    if (token.depth === 2) toc.push({ title: text, id });
    const depth = Math.max(2, token.depth);
    return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${depth}>`;
  };
  renderer.link = function (token) {
    const href = rewriteLink(token.href, doc.path, docs, base);
    const external = /^https?:/.test(href);
    return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${this.parser.parseInline(token.tokens)}${external ? '<span aria-label=" (lien externe)"> ↗</span>' : ''}</a>`;
  };
  renderer.image = (token) => {
    const href = /^(https?:)/i.test(token.href)
      ? token.href
      : /^\w+:|^\/\//.test(token.href)
        ? ''
        : 'https://raw.githubusercontent.com/SIMOND-ANCE-BROS/FFD-Connect/staging/' +
          new URL(token.href, 'https://repository.local/' + doc.path).pathname.slice(1);
    return href
      ? `<img loading="lazy" src="${escapeHtml(href)}" alt="${escapeHtml(token.text)}" />`
      : '';
  };
  renderer.table = function (token) {
    return `<div class="doc-table-scroll" tabindex="0" role="region" aria-label="Tableau défilant">${Renderer.prototype.table.call(this, token)}</div>`;
  };
  const html = new Marked({ renderer, gfm: true }).parse(doc.markdown.replace(/^# .+\r?\n/m, ''), {
    async: false,
  });
  return { html, toc };
}
function header(base: string) {
  const links = `<a href="${base}#modules">L’application</a><a href="${base}#profils">Pour qui ?</a><a href="${base}#roadmap">Le projet</a><a href="${base}documentation/" aria-current="page">Documentation</a>`;
  return `<a class="skip-link" href="#contenu">Aller au contenu</a><header class="site-header"><div class="header-inner"><a href="${base}" class="brand"><img src="${base}app-logo.png" width="40" height="40" alt="" /><span>FFD <b>Connect<span>.</span></b></span></a><nav class="desktop-navigation" aria-label="Navigation principale">${links}</nav><a class="header-cta" href="${base}beta/">Rejoindre la bêta</a><details class="docs-mobile-menu"><summary>Menu</summary><nav aria-label="Navigation mobile">${links}<a href="${base}beta/">Rejoindre la bêta</a></nav></details></div></header>`;
}
function footer(base: string) {
  return `<footer class="site-footer"><div class="section-width"><div class="footer-top"><a class="brand" href="${base}">FFD <b>Connect.</b></a><nav aria-label="Liens de pied de page"><a href="${base}documentation/">Documentation</a><a href="${repo}">GitHub</a><a href="${repo}/issues">Faire un retour</a></nav></div><div class="footer-signature"><p>Le mouvement<br /><em>nous relie.</em></p></div><div class="footer-bottom"><p>© 2026 Gabin Simond · Projet indépendant, non affilié à la Fédération Française de Danse.</p><nav aria-label="Informations légales"><a href="${base}confidentialite/">Confidentialité</a><a href="${base}cgu/">CGU</a><a href="${base}mentions-legales/">Mentions légales</a><a href="${base}suppression-compte/">Suppression du compte</a></nav></div></div></footer>`;
}
export function renderIndex(docs: Doc[], base: string) {
  const cards = [
    ['Bien démarrer', 'Installation, configuration et premiers repères.', 'demarrer'],
    ['Application mobile', 'Le client Expo et React Native, côté pratique.', 'application'],
    ['API & architecture', 'Les services, les données et les décisions du projet.', 'architecture'],
    ['Problèmes connus', 'Les limites identifiées et leurs contournements.', 'problemes-connus'],
  ];
  return (
    header(base) +
    `<main id="contenu" tabindex="-1" class="docs-main section-width"><div class="docs-heading"><p class="eyebrow">LES RESSOURCES DU PROJET</p><h1>Le projet,<br /><em>côté pratique.</em></h1><p class="docs-lede">Des guides à lire ici, des contenus qui évoluent avec le projet. Comprenez FFD Connect, testez la bêta et contribuez à la suite.</p><div class="docs-jump-links"><a class="text-link" href="#articles">Trouver un guide</a><a class="text-link" href="#tester">Comment tester</a><a class="text-link" href="${base}documentation/contribuer/">Contribuer</a></div></div><section class="docs-grid" aria-label="Premiers repères">${cards.map(([title, body, slug], i) => `<article class="doc-card"><div class="doc-card-heading"><span>0${i + 1}</span></div><h2>${title}</h2><p>${body}</p><a class="text-link" href="${base}documentation/${slug}/">Lire le guide ↗</a></article>`).join('')}</section><section id="tester" class="doc-testing"><div><p class="eyebrow">PRENDRE PART À LA SUITE</p><h2>Le meilleur aperçu ?<br />L’application elle-même.</h2></div><div><p>Rejoignez la bêta sur iPhone ou iPad via TestFlight, ou sur Android via le test fermé Google Play. La page d’inscription vous accompagne selon votre appareil.</p><ul class="doc-requirements"><li>iPhone & iPad</li><li>Android</li><li>Version de test</li></ul><a href="${base}beta/" class="button button-primary">Rejoindre la bêta</a></div></section><section id="articles" class="doc-directory"><div class="directory-heading"><div><p class="eyebrow">LA BIBLIOTHÈQUE DU PROJET</p><h2>Une question, un guide.</h2></div><label class="doc-search"><input type="search" data-doc-search aria-label="Rechercher un article" placeholder="Architecture, licence, installation…" /></label></div><p class="doc-directory-status" role="status" data-doc-count>${docs.length} articles · Mis à jour automatiquement avec le dépôt.</p><div class="directory-results">${docs.map((d) => `<a href="${base}documentation/${d.slug}/" data-search="${escapeHtml(d.title + ' ' + d.path)}"><span><small>${escapeHtml(d.path.startsWith('docs/') ? d.path.split('/')[1].replace(/-/g, ' ') : 'Le projet')}</small><strong>${escapeHtml(d.title)}</strong></span><span aria-hidden="true">↗</span></a>`).join('')}</div><p data-doc-empty hidden>Aucun guide ne correspond à cette recherche.</p></section><section class="doc-contribute"><div><h2>Un retour qui fait avancer le projet.</h2><p>Expliquez votre besoin ou les étapes pour reproduire un problème. Les retours sont suivis dans les sujets GitHub.</p></div><a class="button button-outline" href="${repo}/issues/new/choose">Faire un retour</a></section></main>` +
    footer(base)
  );
}
export function renderArticle(doc: Doc, docs: Doc[], base: string) {
  const { html, toc } = renderMarkdown(doc, docs, base);
  const nav = [
    ['demarrer', 'Démarrer'],
    ['application', 'Application mobile'],
    ['architecture', 'Architecture'],
    ['problemes-connus', 'Problèmes connus'],
    ['contribuer', 'Contribuer'],
  ];
  return (
    header(base) +
    `<main id="contenu" tabindex="-1" class="section-width documentation-page"><a class="text-link doc-back" href="${base}documentation/">← Toute la documentation</a><div class="article-layout"><aside class="article-sidebar"><p class="eyebrow">FFD CONNECT / DOCUMENTATION</p><nav aria-label="Rubriques de documentation">${nav.map(([slug, title]) => `<a href="${base}documentation/${slug}/"${slug === doc.slug ? ' aria-current="page"' : ''}>${title}</a>`).join('')}</nav><a class="article-all" href="${base}documentation/#articles">Tous les articles</a><a class="button button-outline" href="${base}beta/">Rejoindre la bêta</a></aside><div class="article-main"><header class="article-heading"><p class="eyebrow">LE PROJET, CÔTÉ PRATIQUE</p><h1>${escapeHtml(doc.title)}</h1><div class="article-sync"><p><span class="sync-dot live"></span>Publié avec la dernière version du site · Source GitHub</p></div></header>${toc.length ? `<details class="article-toc" open><summary>Dans cette page <span>${toc.length} sections</span></summary><nav aria-label="Sommaire de l’article">${toc.map((h) => `<a href="#${escapeHtml(h.id)}">${escapeHtml(h.title)}</a>`).join('')}</nav></details>` : ''}<article class="doc-prose">${html}</article><footer class="article-source"><p>Ce guide est généré automatiquement depuis le dépôt à chaque publication. Son contenu reste lisible sans JavaScript.</p><a href="${repo}/blob/staging/${doc.path}" target="_blank" rel="noreferrer">Voir le fichier source sur GitHub ↗</a></footer></div></div></main>` +
    footer(base)
  );
}
export function documentationPages(): Plugin {
  let base = '/';
  let root = '';
  let docs: Doc[] = [];
  return {
    name: 'ffd-documentation-pages',
    enforce: 'post',
    configResolved(config) {
      base = config.base;
      root = resolve(config.root, '../..');
      docs = collectDocs(root);
    },
    buildStart() {
      for (const doc of docs) this.addWatchFile(resolve(root, doc.path));
    },
    configureServer(server) {
      server.watcher.add(resolve(root, 'docs'));
      server.watcher.on('all', (_event, file) => {
        if (file.endsWith('.md')) docs = collectDocs(root);
      });
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://local').pathname;
        const prefix = base + 'documentation/';
        if (!pathname.startsWith(prefix) || pathname === prefix) return next();
        const slug = decodeURIComponent(pathname.slice(prefix.length).replace(/\/$/, ''));
        const doc = docs.find((d) => d.slug === slug);
        if (!doc) return next();
        const template = readFileSync(
          resolve(server.config.root, 'documentation/index.html'),
          'utf8',
        )
          .replace('<!--documentation-content-->', () => renderArticle(doc, docs, base))
          .replace(
            '<title>Documentation — FFD Connect</title>',
            () => `<title>${escapeHtml(doc.title)} — FFD Connect</title>`,
          );
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(await server.transformIndexHtml(pathname, template));
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.path.replace(/index\.html$/, '').endsWith('/documentation/'))
          return html.replace('<!--documentation-content-->', () => renderIndex(docs, base));
        return html;
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['documentation/index.html'];
        if (!index || index.type !== 'asset')
          throw new Error('Documentation HTML entry was not built');
        const template = String(index.source);
        for (const doc of docs) {
          const source = template
            .replace(
              /<!--documentation-body-->[\s\S]*?<!--\/documentation-body-->/,
              () =>
                `<!--documentation-body-->${renderArticle(doc, docs, base)}<!--/documentation-body-->`,
            )
            .replace(
              '<title>Documentation — FFD Connect</title>',
              () => `<title>${escapeHtml(doc.title)} — FFD Connect</title>`,
            );
          this.emitFile({
            type: 'asset',
            fileName: `documentation/${doc.slug}/index.html`,
            source,
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: 'documentation/manifest.json',
          source: JSON.stringify(docs.map(({ path, slug, title }) => ({ path, slug, title }))),
        });
        // Preserve the old public /docs entry point without an SPA fallback.
        this.emitFile({
          type: 'asset',
          fileName: 'docs/index.html',
          source: `<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${base}documentation/"><title>Documentation — FFD Connect</title><a href="${base}documentation/">Consulter la documentation</a></html>`,
        });
      },
    },
  };
}
