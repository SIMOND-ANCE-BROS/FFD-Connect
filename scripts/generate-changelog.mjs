#!/usr/bin/env node
/**
 * Génère un changelog orienté BETA TESTEURS à partir des commits conventionnels.
 *
 * Source de vérité = les messages de commit (`feat:`, `fix:`, `perf:`, ...),
 * les mêmes que release-please consomme pour la CHANGELOG.md / Release de prod.
 * On ne garde ici que les types UTILES aux testeurs (pas le bruit chore/test/ci).
 *
 * Usage :
 *   node scripts/generate-changelog.mjs [--since <ref>] [--to <ref>]
 *                                       [--version <x.y.z>] [--format <fmt>]
 *                                       [--platform ios|android]
 *
 *   --since    Réf de départ (exclue). Défaut : dernier tag `beta-*`, sinon
 *              dernier tag, sinon le premier commit du dépôt.
 *   --to       Réf de fin (incluse). Défaut : HEAD.
 *   --version  Étiquette de version affichée en tête. Défaut : date du jour.
 *   --format   markdown (défaut) | testflight | json | testers
 *   --heading  `none` : pas de titre « ## <version> — <date> » en markdown (la
 *              promotion bêta titre elle-même la release : « Beta iOS 1.0.0 (19) »).
 *   --platform Base = dernier tag de CETTE plateforme (`beta-*-<platform>-*`) ou
 *              d'une OTA (`beta-*-ota-*`, commune aux deux) : une promotion
 *              iOS seule ne doit pas déplacer la base des notes Android, et
 *              inversement. Sans tag de la plateforme, repli sur `beta-*`.
 *
 * `markdown`   → notes pour la GitHub Release / relecture.
 * `testflight` → texte brut compact pour le champ « What to Test » (TestFlight).
 * `json`       → { version, date, sections: [{ title, entries }] } pour le CI.
 * `testers`    → notes TESTEURS en français (stores), tirées de la section
 *                « ## Pour les testeurs » des PR de l'intervalle (via `gh`) ;
 *                cf. tester-notes.mjs. Les commits, eux, restent en anglais.
 *
 * Implémentation : execFileSync('git', [...]) — jamais de chaîne shell
 * interpolée, donc pas d'injection de commande (les refs viennent du CI).
 */
import { execFileSync } from 'node:child_process';

import { extractTesterSection, prNumber, renderTesterNotes } from './tester-notes.mjs';

// Types de commit exposés aux testeurs, dans l'ordre d'affichage. Tout le reste
// (chore, test, docs, ci, build, style, refactor) est du bruit interne : exclu.
const SECTIONS = [
  { type: 'feat', title: '✨ Features' },
  { type: 'fix', title: '🐛 Fixes' },
  { type: 'perf', title: '⚡ Performance' },
  { type: 'security', title: '🔒 Security' },
];
const BREAKING_TITLE = '⚠️ Breaking changes';

// Périmètres (scope) sans effet visible pour un testeur, même typés feat/fix :
// pipeline, build EAS, site vitrine, dépendances, outillage, infra, docs.
// « feat(ci): run the iOS and Android beta promotions… » n'a rien à faire dans
// « What to Test ».
const INTERNAL_SCOPES = new Set([
  'ci',
  'eas',
  'landing',
  'deps',
  'scripts',
  'release',
  'infra',
  'docs',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) {
      args[key.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

/** Exécute git avec des arguments passés en tableau (pas de shell). */
function git(gitArgs) {
  // stderr capturé : un `describe` sans tag correspondant est un cas prévu
  // (repli), pas une erreur à afficher.
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Dernier tag beta (de la plateforme si donnée), sinon dernier tag beta, sinon
 * dernier tag, sinon premier commit (racine).
 * Cherché depuis le PARENT de `to` : un tag déjà posé sur `to` lui-même (reprise
 * d'un build déjà tagué, `action: resume`) donnerait sinon des notes vides.
 */
function defaultSince(to, platform) {
  const from = `${to}^`;
  if (platform) {
    try {
      return git([
        'describe',
        '--tags',
        '--match',
        `beta-*-${platform}-*`,
        '--match',
        'beta-*-ota-*',
        '--abbrev=0',
        from,
      ]);
    } catch {
      /* pas encore de tag pour cette plateforme */
    }
  }
  try {
    return git(['describe', '--tags', '--match', 'beta-*', '--abbrev=0', from]);
  } catch {
    /* pas de tag beta */
  }
  try {
    return git(['describe', '--tags', '--abbrev=0', from]);
  } catch {
    const roots = git(['rev-list', '--max-parents=0', to]).split('\n');
    return roots[roots.length - 1];
  }
}

/** Parse "type(scope)!: sujet" → { type, breaking, subject } ou null. */
function parseCommit(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  const [, type, scope, bang, rest] = m;
  const breaking = bang === '!';
  // Retire les réfs de PR en fin de sujet (« … (#563) (#549) ») : du bruit
  // pour les testeurs.
  const trimmed = rest.replace(/(?:\s*\(#\d+\))+\s*$/, '').trim();
  const clean = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return {
    type: type.toLowerCase(),
    scope: (scope ?? '').toLowerCase(),
    breaking,
    subject: clean,
  };
}

function collect(since, to) {
  const range = since ? `${since}..${to}` : to;
  // %s = sujet ; on ignore les merges (bruit).
  const raw = git(['log', range, '--no-merges', '--pretty=format:%s']);
  const lines = raw ? raw.split('\n') : [];

  const buckets = new Map(); // title -> Set(subject) (Set = dédup)
  const add = (title, subject) => {
    if (!buckets.has(title)) buckets.set(title, new Set());
    buckets.get(title).add(subject);
  };

  for (const line of lines) {
    const c = parseCommit(line);
    if (!c) continue;
    if (INTERNAL_SCOPES.has(c.scope)) continue;
    const section = SECTIONS.find((s) => s.type === c.type);
    if (c.breaking) add(BREAKING_TITLE, c.subject);
    if (section) add(section.title, c.subject);
  }

  // Ordre : breaking d'abord, puis l'ordre de SECTIONS.
  const ordered = [BREAKING_TITLE, ...SECTIONS.map((s) => s.title)];
  return ordered
    .filter((title) => buckets.has(title))
    .map((title) => ({ title, entries: [...buckets.get(title)] }));
}

/**
 * Sections « Pour les testeurs » des PR de l'intervalle, de la plus ancienne à
 * la plus récente. Une PR illisible (gh absent, réseau) est signalée sur stderr
 * et ignorée : les notes ne doivent pas bloquer une promotion.
 */
function collectTesterSections(since, to) {
  const range = since ? `${since}..${to}` : to;
  const raw = git(['log', range, '--no-merges', '--reverse', '--pretty=format:%s']);
  const numbers = [...new Set((raw ? raw.split('\n') : []).map(prNumber).filter(Boolean))];
  const sections = [];
  for (const number of numbers) {
    try {
      const body = execFileSync(
        'gh',
        ['pr', 'view', String(number), '--json', 'body', '--jq', '.body'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const section = extractTesterSection(body);
      if (section) sections.push(section);
    } catch {
      process.stderr.write(`⚠️  PR #${number} illisible (gh), ignorée dans les notes testeurs\n`);
    }
  }
  return sections;
}

function render(sections, version, date, format, heading = true) {
  if (format === 'json') {
    return JSON.stringify({ version, date, sections }, null, 2);
  }
  if (sections.length === 0) {
    return format === 'testflight'
      ? 'Bug fixes and improvements.'
      : `${heading ? `## ${version} — ${date}\n\n` : ''}_No user-facing changes._`;
  }
  if (format === 'testflight') {
    // Texte brut, sans markdown (TestFlight n'affiche pas le markdown).
    return sections
      .map((s) => {
        const title = s.title.replace(/^\S+\s/, ''); // retire l'emoji de tête
        return `${title}\n${s.entries.map((e) => `• ${e}`).join('\n')}`;
      })
      .join('\n\n');
  }
  // markdown
  const body = sections
    .map((s) => `### ${s.title}\n${s.entries.map((e) => `- ${e}`).join('\n')}`)
    .join('\n\n');
  return heading ? `## ${version} — ${date}\n\n${body}` : body;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const to = args.to || 'HEAD';
  if (args.platform && !['ios', 'android'].includes(args.platform)) {
    throw new Error(`--platform : ios ou android attendu, reçu « ${args.platform} »`);
  }
  const since = args.since || defaultSince(to, args.platform);
  const version = args.version || `beta ${new Date().toISOString().slice(0, 10)}`;
  const date = new Date().toISOString().slice(0, 10);
  const format = args.format || 'markdown';

  if (format === 'testers') {
    process.stdout.write(renderTesterNotes(collectTesterSections(since, to)) + '\n');
    return;
  }
  const sections = collect(since, to);
  if (args.heading && args.heading !== 'none') {
    throw new Error(`--heading : seule la valeur « none » est acceptée, reçu « ${args.heading} »`);
  }
  const heading = args.heading !== 'none';
  process.stdout.write(render(sections, version, date, format, heading) + '\n');
}

main();
