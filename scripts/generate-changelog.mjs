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
 *
 *   --since    Réf de départ (exclue). Défaut : dernier tag `beta-*`, sinon
 *              dernier tag, sinon le premier commit du dépôt.
 *   --to       Réf de fin (incluse). Défaut : HEAD.
 *   --version  Étiquette de version affichée en tête. Défaut : date du jour.
 *   --format   markdown (défaut) | testflight | json
 *
 * `markdown`   → notes pour la GitHub Release / relecture.
 * `testflight` → texte brut compact pour le champ « What to Test » (TestFlight).
 * `json`       → { version, date, sections: [{ title, entries }] } pour le CI.
 *
 * Implémentation : execFileSync('git', [...]) — jamais de chaîne shell
 * interpolée, donc pas d'injection de commande (les refs viennent du CI).
 */
import { execFileSync } from 'node:child_process';

// Types de commit exposés aux testeurs, dans l'ordre d'affichage. Tout le reste
// (chore, test, docs, ci, build, style, refactor) est du bruit interne : exclu.
const SECTIONS = [
  { type: 'feat', title: '✨ Nouveautés' },
  { type: 'fix', title: '🐛 Corrections' },
  { type: 'perf', title: '⚡ Améliorations' },
  { type: 'security', title: '🔒 Sécurité' },
];
const BREAKING_TITLE = '⚠️ Changements importants';

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
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
}

/** Dernier tag beta, sinon dernier tag, sinon premier commit (racine). */
function defaultSince() {
  try {
    return git(['describe', '--tags', '--match', 'beta-*', '--abbrev=0']);
  } catch {
    /* pas de tag beta */
  }
  try {
    return git(['describe', '--tags', '--abbrev=0']);
  } catch {
    const roots = git(['rev-list', '--max-parents=0', 'HEAD']).split('\n');
    return roots[roots.length - 1];
  }
}

/** Parse "type(scope)!: sujet" → { type, breaking, subject } ou null. */
function parseCommit(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  const [, type, , bang, rest] = m;
  const breaking = bang === '!';
  // Retire les réfs de PR en fin de sujet (« … (#563) (#549) ») : du bruit
  // pour les testeurs.
  const trimmed = rest.replace(/(?:\s*\(#\d+\))+\s*$/, '').trim();
  const clean = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return { type: type.toLowerCase(), breaking, subject: clean };
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

function render(sections, version, date, format) {
  if (format === 'json') {
    return JSON.stringify({ version, date, sections }, null, 2);
  }
  if (sections.length === 0) {
    return format === 'testflight'
      ? 'Corrections et améliorations diverses.'
      : `## ${version} — ${date}\n\n_Aucun changement destiné aux testeurs._`;
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
  return `## ${version} — ${date}\n\n${body}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const to = args.to || 'HEAD';
  const since = args.since || defaultSince();
  const version = args.version || `beta ${new Date().toISOString().slice(0, 10)}`;
  const date = new Date().toISOString().slice(0, 10);
  const format = args.format || 'markdown';

  const sections = collect(since, to);
  process.stdout.write(render(sections, version, date, format) + '\n');
}

main();
