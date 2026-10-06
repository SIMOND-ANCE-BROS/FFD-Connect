/**
 * Choix d'un build EAS deja construit et envoi vers App Store Connect.
 *
 *   pnpm submit:beta                 liste les builds `beta` finis, demande lequel
 *   pnpm submit:beta --latest        prend le plus recent sans demander
 *   pnpm submit:beta --id <uuid>     envoie celui-la directement
 *   pnpm submit:beta --profile preview
 *   pnpm submit:beta --dry-run       affiche la commande sans l'executer
 *
 * Pourquoi ce script existe : `eas submit` echoue de deux facons peu lisibles.
 *
 * 1. Sans `EXPO_PUBLIC_APP_ENV`, `app.config.js` retombe sur la variante
 *    `development` et la CLI cherche les credentials de `fr.ffdanse.connect.dev`
 *    au lieu de `.beta`. Le message parle de credentials, pas de variante — on
 *    cherche longtemps du mauvais cote. Ce script aligne toujours la variable
 *    sur le profil.
 * 2. Sans `--profile`, le profil de soumission par defaut est `production`, qui
 *    n'a pas d'`ascAppId` configure.
 *
 * Il ne fait QUE l'envoi vers App Store Connect, qui fonctionne en plan EAS
 * gratuit. L'ajout au groupe TestFlight externe et la Beta App Review passent
 * par `scripts/testflight-distribute.ts` (API App Store Connect) : le job
 * `testflight` d'EAS qui les automatise exige un plan payant.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(REPO_ROOT, 'apps', 'client');

/** Au-dela, la liste devient illisible dans un terminal. */
const LIST_LIMIT = 10;

export interface Options {
  profile: string;
  id?: string;
  latest: boolean;
  dryRun: boolean;
}

export interface Build {
  id: string;
  status: string;
  profile: string;
  appVersion: string;
  buildNumber: string;
  completedAt: string;
  commit: string;
  hasArtifact: boolean;
}

export function parseFlags(argv: string[]): Options {
  const options: Options = { profile: 'beta', latest: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--latest') options.latest = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--id') options.id = argv[++i];
    else if (flag === '--profile') options.profile = argv[++i] ?? 'beta';
    else if (flag === '--help' || flag === '-h') {
      printUsage();
      process.exit(0);
    } else throw new Error(`Option inconnue : ${flag}`);
  }
  if (options.id && options.latest) {
    throw new Error('--id et --latest sont exclusifs.');
  }
  if (!options.profile) throw new Error('--profile attend une valeur.');
  return options;
}

function printUsage(): void {
  console.log(
    [
      'Usage : pnpm submit:beta [options]',
      '',
      '  --latest           envoie le build le plus recent sans demander',
      '  --id <uuid>        envoie ce build precis',
      '  --profile <nom>    profil EAS (defaut : beta)',
      '  --dry-run          affiche la commande sans l executer',
    ].join('\n'),
  );
}

/**
 * Ne garde que ce qui est envoyable : termine ET avec une archive. Un build
 * `FINISHED` dont l'artefact a expire (30 jours) echouerait a l'envoi avec un
 * message obscur.
 */
export function parseBuilds(json: string): Build[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Sortie d'`eas build:list` illisible (JSON invalide).");
  }
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((b) => ({
      id: String(b.id ?? ''),
      status: String(b.status ?? ''),
      profile: String(b.buildProfile ?? ''),
      appVersion: String(b.appVersion ?? '?'),
      buildNumber: String(b.appBuildVersion ?? '?'),
      completedAt: String(b.completedAt ?? ''),
      commit: String(b.gitCommitHash ?? '').slice(0, 9),
      hasArtifact: Boolean(
        (b.artifacts as Record<string, unknown> | undefined)?.applicationArchiveUrl,
      ),
    }))
    .filter((b) => b.id && b.status === 'FINISHED' && b.hasArtifact);
}

export function describe(build: Build): string {
  const date = build.completedAt
    ? new Date(build.completedAt).toLocaleString('fr-FR')
    : 'date inconnue';
  return `build ${build.buildNumber} (v${build.appVersion})  ${date}  ${build.commit}`;
}

/** `ask` = il faut interroger l'utilisateur. */
export function selectBuild(
  builds: Build[],
  options: { id?: string; latest?: boolean },
): Build | 'ask' {
  if (builds.length === 0) {
    throw new Error('Aucun build envoyable (termine et avec archive) pour ce profil.');
  }
  if (options.id) {
    const found = builds.find((b) => b.id === options.id);
    if (!found) {
      throw new Error(
        `Build ${options.id} introuvable parmi les ${builds.length} derniers builds envoyables.`,
      );
    }
    return found;
  }
  if (options.latest || builds.length === 1) return builds[0];
  return 'ask';
}

/**
 * La variante DOIT correspondre au profil : `app.config.js` derive le bundle id
 * d'`EXPO_PUBLIC_APP_ENV`, et la CLI cherche les credentials de ce bundle.
 */
export function submitEnv(profile: string): Record<string, string> {
  return { EXPO_PUBLIC_APP_ENV: profile };
}

export function submitArgs(profile: string, buildId: string): string[] {
  return ['submit', '--platform', 'ios', '--profile', profile, '--id', buildId];
}

async function promptBuild(builds: Build[]): Promise<Build> {
  console.log('\nBuilds envoyables :\n');
  builds.forEach((b, i) => console.log(`  ${i + 1}. ${describe(b)}`));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    for (;;) {
      const answer = await new Promise<string>((resolve) =>
        rl.question(`\nLequel ? [1-${builds.length}] `, resolve),
      );
      const index = Number.parseInt(answer.trim(), 10);
      if (Number.isInteger(index) && index >= 1 && index <= builds.length) {
        return builds[index - 1];
      }
      console.log('Reponse invalide.');
    }
  } finally {
    rl.close();
  }
}

function listBuilds(profile: string): Build[] {
  let json: string;
  try {
    json = execFileSync(
      'eas',
      [
        'build:list',
        '--platform',
        'ios',
        '--profile',
        profile,
        '--limit',
        String(LIST_LIMIT),
        '--json',
        '--non-interactive',
      ],
      { cwd: CLIENT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    throw new Error('`eas build:list` a echoue. Es-tu connecte ? (`eas whoami`)');
  }
  return parseBuilds(json);
}

async function main(): Promise<void> {
  const options = parseFlags(process.argv.slice(2));
  const builds = listBuilds(options.profile);
  const picked = selectBuild(builds, options);
  const build = picked === 'ask' ? await promptBuild(builds) : picked;

  const args = submitArgs(options.profile, build.id);
  const env = submitEnv(options.profile);

  console.log(`\n→ ${describe(build)}`);
  console.log(`  EXPO_PUBLIC_APP_ENV=${env.EXPO_PUBLIC_APP_ENV} eas ${args.join(' ')}\n`);

  if (options.dryRun) {
    console.log('(--dry-run : rien envoye)');
    return;
  }

  const result = spawnSync('eas', args, {
    cwd: CLIENT_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(
    [
      '',
      'Envoye a App Store Connect. Apple traite la version en 5-10 min.',
      '',
      'Testeurs INTERNES : rien de plus a faire.',
      'Testeurs EXTERNES : `pnpm testflight:distribute --build-number <n>` ajoute',
      'la version au groupe et la soumet a la Beta App Review (cle ASC requise,',
      'cf. docs/exploitation/changelog-beta.md).',
    ].join('\n'),
  );
}

// Pas d'execution a l'import : le fichier de test importe les fonctions pures.
if (process.argv[1] && process.argv[1].endsWith('submit-beta.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
