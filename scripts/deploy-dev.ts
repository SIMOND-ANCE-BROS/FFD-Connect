/**
 * Build + installation de l'app client sur un iPhone physique.
 *
 *   pnpm deploy:dev                    debug, backend local (IP LAN detectee)
 *   pnpm deploy:dev --staging          debug, backend staging
 *   pnpm deploy:dev --release          standalone, backend staging
 *   pnpm deploy:dev --device "iPhone de Gabin"
 *   pnpm deploy:dev --clean            prebuild --clean d'abord
 *
 * Toujours la variante `development` (bundle fr.ffdanse.connect.dev) : elle a
 * sa propre icone et son propre bundle id, donc elle coexiste avec la beta
 * TestFlight et la prod sur le meme telephone sans rien ecraser.
 *
 * Pourquoi `--release` refuse le backend local : un standalone existe pour
 * tourner sans le Mac, en conditions reelles ; le pointer sur un backend
 * joignable seulement en LAN le rend mort des qu'on quitte le wifi. Et
 * techniquement, `eas build --local` archive le projet en excluant les fichiers
 * gitignores, et les profils eas.json sont statiques : une IP dynamique
 * n'arriverait pas dans le build de toute facon.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(REPO_ROOT, 'apps', 'client');

const BACKEND_PORT = 3000;
const STAGING_API_URL = 'https://api-staging.ffd.gabin-simond.fr/api/v1';
const STANDALONE_PROFILE = 'development-ios-standalone';

export type Mode = 'debug' | 'release';
export type Backend = 'local' | 'staging';

export interface Options {
  mode: Mode;
  backend: Backend;
  device?: string;
  clean: boolean;
}

/** Erreur imputable a l'usage : affichee sans stack trace. */
export class UsageError extends Error {}

/** Un appareil tel que le rapporte `xcrun devicectl list devices`. */
export interface Device {
  name: string;
  udid: string;
  available: boolean;
}

export function parseFlags(argv: string[]): Options {
  let mode: Mode = 'debug';
  let backend: Backend | undefined;
  let device: string | undefined;
  let clean = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--release':
        mode = 'release';
        break;
      case '--debug':
        mode = 'debug';
        break;
      case '--local':
        backend = 'local';
        break;
      case '--staging':
        backend = 'staging';
        break;
      case '--clean':
        clean = true;
        break;
      case '--device': {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new UsageError('--device attend un nom ou un UDID');
        }
        device = next;
        i += 1;
        break;
      }
      default:
        throw new UsageError(`Option inconnue : ${arg}`);
    }
  }

  if (mode === 'release' && backend === 'local') {
    throw new UsageError(
      '--release ne peut pas viser le backend local.\n' +
        '  Un standalone tourne sans ton Mac : une URL en IP LAN le rendrait\n' +
        '  inutilisable des que tu quittes le wifi, et `eas build --local`\n' +
        "  n'embarque pas les fichiers gitignores.\n" +
        '  Utilise `--release` seul (staging), ou enleve `--release`.',
    );
  }

  // Le standalone n'a que staging comme cible coherente ; le debug prend le
  // local par defaut, c'est ce qui en fait une commande de developpement.
  return {
    mode,
    backend: backend ?? (mode === 'release' ? 'staging' : 'local'),
    device,
    clean,
  };
}

/**
 * Premiere IPv4 non-interne. Un iPhone physique ne peut pas joindre
 * localhost : c'est cette adresse qu'il faut embarquer dans le bundle.
 */
export function detectLanIp(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  throw new UsageError(
    'Aucune IP LAN trouvee : pas de reseau actif ?\n' +
      '  Sans elle le telephone ne peut pas joindre ton backend. Utilise `--staging`.',
  );
}

export function resolveEnv(options: Options, lanIp?: string): Record<string, string> {
  const apiUrl =
    options.backend === 'local'
      ? `http://${lanIp ?? detectLanIp()}:${String(BACKEND_PORT)}/api/v1`
      : STAGING_API_URL;

  return {
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_API_URL: apiUrl,
  };
}

/** Extrait les appareils de la sortie JSON de devicectl. */
export function parseDevices(json: string): Device[] {
  const parsed: unknown = JSON.parse(json);
  const devices = (parsed as { result?: { devices?: unknown[] } }).result?.devices ?? [];

  return devices.flatMap((entry): Device[] => {
    const device = entry as {
      hardwareProperties?: { udid?: string };
      deviceProperties?: { name?: string };
      connectionProperties?: { tunnelState?: string };
    };
    const udid = device.hardwareProperties?.udid;
    const name = device.deviceProperties?.name;
    if (udid === undefined || name === undefined) return [];
    return [
      {
        name,
        udid,
        // devicectl rapporte "unavailable" pour un appareil appaire mais
        // verrouille ou debranche : inutilisable pour une installation.
        available: device.connectionProperties?.tunnelState !== 'unavailable',
      },
    ];
  });
}

/** Renvoie l'appareil retenu, ou 'ask' s'il faut demander a l'utilisateur. */
export function selectDevice(devices: Device[], wanted?: string): Device | 'ask' {
  const usable = devices.filter((d) => d.available);

  if (wanted !== undefined) {
    const match = devices.find((d) => d.udid === wanted || d.name === wanted);
    if (match === undefined) {
      const known = devices.map((d) => d.name).join(', ');
      throw new UsageError(
        `Appareil introuvable : ${wanted}\n  Connus : ${known.length > 0 ? known : 'aucun'}`,
      );
    }
    if (!match.available) {
      throw new UsageError(
        `${match.name} est appaire mais indisponible : deverrouille-le et rebranche-le.`,
      );
    }
    return match;
  }

  if (usable.length === 0) {
    const paired = devices.map((d) => d.name).join(', ');
    throw new UsageError(
      paired.length > 0
        ? `Aucun appareil disponible. Appaires mais indisponibles : ${paired}.\n` +
            "  Deverrouille l'iPhone et laisse-le branche."
        : 'Aucun iPhone detecte. Branche-le et accepte « Faire confiance a cet ordinateur ».',
    );
  }
  if (usable.length === 1) return usable[0];
  return 'ask';
}

async function promptDevice(devices: Device[]): Promise<Device> {
  const usable = devices.filter((d) => d.available);
  console.log('\n📱 Plusieurs appareils disponibles :\n');
  usable.forEach((d, i) => {
    console.log(`   ${String(i + 1)}. ${d.name}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question('\n   Numero : ', resolve);
    });
    const chosen = usable[Number.parseInt(answer.trim(), 10) - 1];
    if (chosen === undefined) throw new UsageError('Choix invalide.');
    return chosen;
  } finally {
    rl.close();
  }
}

function listDevices(): Device[] {
  let json: string;
  try {
    json = execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', '-'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new UsageError(
      '`xcrun devicectl` a echoue. Xcode 15+ et ses outils en ligne de commande sont requis.',
    );
  }
  return parseDevices(json);
}

/**
 * Le backend local est sonde AVANT le build : sinon on decouvre au bout de
 * quinze minutes que l'app pointe sur rien.
 */
function warnIfBackendDown(apiUrl: string): void {
  const healthUrl = `${apiUrl.replace(/\/api\/v1$/, '')}/health`;
  const probe = spawnSync('curl', ['-sS', '-m', '3', '-o', '/dev/null', healthUrl], {
    stdio: 'ignore',
  });
  if (probe.status !== 0) {
    console.warn(
      `\n⚠️  ${healthUrl} ne repond pas.\n` +
        "   Lance `pnpm start:dev` dans un autre terminal, sinon l'app se buildera\n" +
        '   correctement mais ne pourra pas se connecter.\n',
    );
  }
}

function run(command: string, args: string[], env: Record<string, string>): void {
  const result = spawnSync(command, args, {
    cwd: CLIENT_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} a echoue (code ${String(result.status)})`);
  }
}

function deployDebug(device: Device, env: Record<string, string>, clean: boolean): void {
  if (clean) run('pnpm', ['exec', 'expo', 'prebuild', '--clean'], env);
  console.log(`\n🔨 Build debug puis installation sur ${device.name}\n`);
  // expo run:ios enchaine prebuild, build, installation et lancement de Metro.
  run('pnpm', ['exec', 'expo', 'run:ios', '--device', device.udid], env);
}

/**
 * `eas build --local` depose son artefact a la racine du package client, avec
 * un nom horodate : on prend le plus recent plutot que de le deviner.
 */
function findBuiltApp(): string {
  const latest = execFileSync('ls', ['-t', CLIENT_DIR], { encoding: 'utf-8' })
    .split('\n')
    .find((name) => name.endsWith('.ipa') || name.endsWith('.app'));
  if (latest === undefined) {
    throw new Error("Aucun .ipa/.app trouve apres le build. Voir la sortie d'eas build ci-dessus.");
  }
  return path.join(CLIENT_DIR, latest);
}

function deployRelease(device: Device, env: Record<string, string>): void {
  console.log(`\n📦 Build standalone (~20-30 min) puis installation sur ${device.name}\n`);
  run(
    'pnpm',
    ['exec', 'eas', 'build', '--local', '--profile', STANDALONE_PROFILE, '--platform', 'ios'],
    env,
  );
  console.log('\n📲 Installation…\n');
  run('ios-deploy', ['--id', device.udid, '--bundle', findBuiltApp()], env);
}

async function main(): Promise<void> {
  const options = parseFlags(process.argv.slice(2));
  const env = resolveEnv(options);

  console.log('🎯 Variante development (fr.ffdanse.connect.dev)');
  console.log(`   mode    : ${options.mode}`);
  console.log(`   backend : ${env.EXPO_PUBLIC_API_URL}`);

  if (options.backend === 'local') warnIfBackendDown(env.EXPO_PUBLIC_API_URL);

  const devices = listDevices();
  const selected = selectDevice(devices, options.device);
  const device = selected === 'ask' ? await promptDevice(devices) : selected;

  if (options.mode === 'debug') {
    deployDebug(device, env, options.clean);
  } else {
    deployRelease(device, env);
  }
}

// Ne s'execute pas a l'import, pour que le fichier de test puisse importer les
// fonctions pures sans declencher un build.
if (process.argv[1]?.endsWith('deploy-dev.ts') === true) {
  main().catch((error: unknown) => {
    console.error(`\n❌ ${(error as Error).message}\n`);
    process.exit(1);
  });
}
