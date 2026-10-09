import { readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { Marked, Renderer } from 'marked';
import type { Plugin } from 'vite';

export type Audience = 'utilisateurs' | 'technique';
export const audienceForPath = (path: string): Audience =>
  path.startsWith('docs/utilisateurs/') ? 'utilisateurs' : 'technique';

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
  const slugs = new Set<string>(['utilisateurs', 'technique']);
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
    return (
      base +
      'documentation/' +
      audienceForPath(path + '/') +
      '/?q=' +
      encodeURIComponent(path.replace(/\/$/, '')) +
      '#articles'
    );
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
  renderer.code = function (token) {
    if (token.lang === 'ffd-demo') {
      const view = token.text.trim();
      const labels: Record<string, string> = {
        licence: 'Retrouver sa licence',
        competitions: 'Préparer une compétition',
        audio: 'Retrouver sa musique',
        organisation: 'Découvrir l’espace club',
      };
      if (!Object.prototype.hasOwnProperty.call(labels, view))
        throw new Error(`Unknown ffd-demo view in ${doc.path}: ${view}`);
      return `<details class="guide-demo" data-guide-demo="${view}"><summary>${labels[view]} · Ouvrir l’aperçu interactif</summary><p>Adaptation web des écrans de l’app · Données fictives · Aucun compte connecté.</p><div data-guide-demo-root></div><p data-guide-demo-status role="status">L’aperçu se charge à l’ouverture avec JavaScript. Les étapes du guide restent disponibles ci-dessous.</p></details>`;
    }
    if (token.lang === 'ffd-parcours') {
      const rows = token.text
        .trim()
        .split('\n')
        .map((line) => line.split('|').map((cell) => cell.trim()));
      if (rows.length < 2 || rows.some((row) => row.length !== 3 || row.some((cell) => !cell)))
        throw new Error(`ffd-parcours requires Screen | Action | Result rows in ${doc.path}`);
      return `<ol class="guide-route" aria-label="Le parcours en un regard">${rows.map(([screen, action, result], i) => `<li><span class="guide-route-number" aria-hidden="true">${i + 1}</span><div><p class="guide-route-screen">${escapeHtml(screen)}</p><strong>${escapeHtml(action)}</strong><p>${escapeHtml(result)}</p></div></li>`).join('')}</ol>`;
    }
    return Renderer.prototype.code.call(this, token);
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
function audienceNavigation(base: string, current?: Audience) {
  return `<nav class="doc-audiences" aria-label="Choisir une documentation"><a href="${base}documentation/">Toutes les ressources</a><a href="${base}documentation/utilisateurs/"${current === 'utilisateurs' ? ' aria-current="page"' : ''}>Utiliser FFD Connect</a><a href="${base}documentation/technique/"${current === 'technique' ? ' aria-current="page"' : ''}>Documentation technique</a></nav>`;
}
const userPaths = [
  [
    'Danseurs',
    'Retrouver sa licence, préparer une compétition et sa musique.',
    'utilisateurs/danseurs',
  ],
  [
    'Responsables de club',
    'Suivre les membres, les couples et les inscriptions.',
    'utilisateurs/clubs',
  ],
  [
    'Staff & accueil',
    'Se repérer le jour J et utiliser le scanner de licences.',
    'utilisateurs/staff',
  ],
  [
    'Administrateurs',
    'Gérer les comptes et les clubs dans le back-office web.',
    'utilisateurs/administrateurs',
  ],
];
function cardsHtml(cards: string[][], base: string) {
  return cards
    .map(
      ([title, body, slug], i) =>
        `<article class="doc-card"><div class="doc-card-heading"><span>0${i + 1}</span></div><h2>${title}</h2><p>${body}</p><a class="text-link" href="${base}documentation/${slug}/">${slug === 'utilisateurs' || slug === 'technique' ? 'Explorer cet espace' : 'Lire le guide'} →</a></article>`,
    )
    .join('');
}
export function renderIndex(docs: Doc[], base: string, audience?: Audience) {
  const users = audience === 'utilisateurs';
  const selected = docs.filter((doc) => audienceForPath(doc.path) === audience);
  const title = !audience
    ? 'Trouvez le bon guide.'
    : users
      ? 'Comment pouvons-nous vous aider ?'
      : 'La documentation technique.';
  const lede = !audience
    ? 'Apprendre à utiliser l’application ou comprendre sa construction : choisissez votre espace.'
    : users
      ? 'Des parcours concrets pour démarrer, retrouver les bons écrans et accomplir vos tâches selon votre rôle.'
      : 'Installation, architecture, API et exploitation : les ressources pour développer et maintenir FFD Connect.';
  const cards = !audience
    ? [
        [
          'Utiliser FFD Connect',
          'Premiers pas, parcours danseur, club, staff et administration. Des étapes à suivre dans l’application et le back-office.',
          'utilisateurs',
        ],
        [
          'Documentation technique',
          'Installer le projet, comprendre son architecture, contribuer au code et exploiter les services.',
          'technique',
        ],
      ]
    : users
      ? userPaths
      : [
          ['Installer le projet', 'Préparer son environnement de développement.', 'demarrer'],
          ['Client mobile', 'Expo, React Native et configuration du client.', 'application'],
          [
            'API & architecture',
            'Les services, les données et les décisions du projet.',
            'architecture',
          ],
          ['Contribuer au code', 'Conventions, tests et workflow de contribution.', 'contribuer'],
        ];
  const directory = audience
    ? `<section id="articles" class="doc-directory"><div class="directory-heading"><div><p class="eyebrow">${users ? 'LES GUIDES D’UTILISATION' : 'LES RESSOURCES TECHNIQUES'}</p><h2>${users ? 'Que souhaitez-vous faire ?' : 'Trouver une référence.'}</h2></div><label class="doc-search"><input type="search" data-doc-search aria-label="${users ? 'Rechercher un guide utilisateur' : 'Rechercher un article technique'}" placeholder="${users ? 'Licence, club, compte…' : 'Architecture, API, installation…'}" /></label></div><p class="doc-directory-status" role="status" data-doc-count>${selected.length} articles · Mis à jour automatiquement avec le dépôt.</p><div class="directory-results">${selected.map((d) => `<a href="${base}documentation/${d.slug}/" data-doc-audience="${audienceForPath(d.path)}" data-search="${escapeHtml(d.title + ' ' + d.path + (users ? ' ' + d.markdown : ''))}"><span><small>${users ? 'Guide utilisateur' : escapeHtml(d.path.startsWith('docs/') ? d.path.split('/')[1].replace(/-/g, ' ') : 'Le projet')}</small><strong>${escapeHtml(d.title)}</strong></span><span aria-hidden="true">→</span></a>`).join('')}</div><p data-doc-empty hidden>Aucun guide ne correspond à cette recherche.</p></section>`
    : '';
  return (
    header(base) +
    `<main id="contenu" tabindex="-1" class="docs-main docs-compact section-width">${audienceNavigation(base, audience)}<div class="docs-heading"><p class="eyebrow">${!audience ? 'LES RESSOURCES FFD CONNECT' : users ? 'DOCUMENTATION UTILISATEURS' : 'DÉVELOPPEMENT & EXPLOITATION'}</p><h1>${title}</h1><p class="docs-lede">${lede}</p>${audience ? '<a class="text-link" href="#articles">Voir tous les articles de cet espace ↓</a>' : ''}</div>${users ? `<section class="doc-start"><div><p class="eyebrow">VOTRE PREMIÈRE VISITE</p><h2>Vous découvrez l’app ?</h2><p>Installer l’app, se connecter et comprendre les espaces.</p></div><a class="button button-primary" href="${base}documentation/utilisateurs/premiers-pas/">Commencer ici →</a></section>` : ''}<section class="docs-grid${!audience ? ' doc-portal-cards' : ''}" aria-label="${!audience ? 'Deux espaces de documentation' : users ? 'Choisir son parcours' : 'Repères techniques'}">${cardsHtml(cards, base)}</section>${directory}${audience !== 'technique' ? `<section class="doc-testing"><div><p class="eyebrow">PASSER À LA PRATIQUE</p><h2>Prêt à essayer ?</h2></div><div><p>La bêta est accessible via TestFlight sur iPhone et iPad, et le test fermé Google Play sur Android. La page d’inscription vous accompagne.</p><a href="${base}beta/" class="button button-primary">Rejoindre la bêta</a></div></section>` : ''}</main>` +
    footer(base)
  );
}
export function renderArticle(doc: Doc, docs: Doc[], base: string) {
  const { html, toc } = renderMarkdown(doc, docs, base);
  const audience = audienceForPath(doc.path);
  const users = audience === 'utilisateurs';
  const nav = users
    ? [
        ['utilisateurs/premiers-pas', 'Premiers pas'],
        ...userPaths.map(([title, , slug]) => [slug, title]),
        ['utilisateurs/espaces-et-compte', 'Espaces et compte'],
      ]
    : [
        ['demarrer', 'Démarrer'],
        ['application', 'Application mobile'],
        ['architecture', 'Architecture'],
        ['problemes-connus', 'Problèmes connus'],
        ['contribuer', 'Contribuer'],
      ];
  return (
    header(base) +
    `<main id="contenu" tabindex="-1" class="section-width documentation-page">${audienceNavigation(base, audience)}<a class="text-link doc-back" href="${base}documentation/${audience}/">← ${users ? 'Les guides d’utilisation' : 'Les ressources techniques'}</a><div class="article-layout"><aside class="article-sidebar"><p class="eyebrow">${users ? 'GUIDES UTILISATEURS' : 'DOCUMENTATION TECHNIQUE'}</p><nav aria-label="Rubriques de documentation">${nav.map(([slug, title]) => `<a href="${base}documentation/${slug}/"${slug === doc.slug ? ' aria-current="page"' : ''}>${title}</a>`).join('')}</nav><a class="article-all" href="${base}documentation/${audience}/#articles">Tous les articles</a><a class="button button-outline" href="${base}beta/">Rejoindre la bêta</a></aside><div class="article-main"><header class="article-heading"><p class="eyebrow">${users ? 'UTILISER FFD CONNECT' : 'LE PROJET, CÔTÉ TECHNIQUE'}</p><h1>${escapeHtml(doc.title)}</h1><div class="article-sync"><p><span class="sync-dot live"></span>Publié avec la dernière version du site · Source GitHub</p></div></header>${toc.length ? `<details class="article-toc" open><summary>Dans cette page <span>${toc.length} sections</span></summary><nav aria-label="Sommaire de l’article">${toc.map((h) => `<a href="#${escapeHtml(h.id)}">${escapeHtml(h.title)}</a>`).join('')}</nav></details>` : ''}<article class="doc-prose">${html}</article><footer class="article-source"><p>Ce guide est généré automatiquement depuis le dépôt à chaque publication. Son contenu reste lisible sans JavaScript.</p><a href="${repo}/blob/staging/${doc.path}" target="_blank" rel="noreferrer">Voir le fichier source sur GitHub ↗</a></footer></div></div></main>` +
    footer(base)
  );
}
function renderDocument(template: string, body: string, title: string) {
  return template
    .replace(
      /<!--documentation-body-->[\s\S]*?<!--\/documentation-body-->/,
      () => `<!--documentation-body-->${body}<!--/documentation-body-->`,
    )
    .replace(
      '<title>Documentation — FFD Connect</title>',
      () => `<title>${escapeHtml(title.replace(/ — FFD Connect$/, ''))} — FFD Connect</title>`,
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
        const audience = slug === 'utilisateurs' || slug === 'technique' ? slug : undefined;
        const doc = docs.find((d) => d.slug === slug);
        if (!doc && !audience) return next();
        const template = renderDocument(
          readFileSync(resolve(server.config.root, 'documentation/index.html'), 'utf8'),
          audience ? renderIndex(docs, base, audience) : renderArticle(doc!, docs, base),
          audience
            ? audience === 'utilisateurs'
              ? 'Guides utilisateurs'
              : 'Documentation technique'
            : doc!.title,
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
        for (const audience of ['utilisateurs', 'technique'] as const) {
          this.emitFile({
            type: 'asset',
            fileName: `documentation/${audience}/index.html`,
            source: renderDocument(
              template,
              renderIndex(docs, base, audience),
              audience === 'utilisateurs' ? 'Guides utilisateurs' : 'Documentation technique',
            ),
          });
        }
        for (const doc of docs) {
          const source = renderDocument(template, renderArticle(doc, docs, base), doc.title);
          this.emitFile({
            type: 'asset',
            fileName: `documentation/${doc.slug}/index.html`,
            source,
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: 'documentation/manifest.json',
          source: JSON.stringify(
            docs.map(({ path, slug, title }) => ({
              path,
              slug,
              title,
              audience: audienceForPath(path),
            })),
          ),
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
