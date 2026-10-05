/**
 * Tests des fonctions pures de `deploy-dev`.
 *
 * Autonome a dessein, comme `audit-exceptions.test.ts` : la config Jest racine
 * n'orchestre que `apps/backend` et `apps/client`, un test pose dans `scripts/`
 * n'y serait jamais execute. Il tourne avec `tsx`, via `pnpm deploy:dev:test`.
 *
 * Les deux fonctions de deploiement ne sont pas testees : ce sont des
 * enchainements de `spawnSync`, et mocker le lancement de process ne
 * verifierait rien de reel.
 */

import assert from 'assert';
import type * as os from 'os';

import {
  UsageError,
  detectLanIp,
  parseDevices,
  parseFlags,
  resolveEnv,
  selectDevice,
  type Device,
} from './deploy-dev';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${(error as Error).message}`);
  }
}

const device = (over: Partial<Device> = {}): Device => ({
  name: 'iPhone de Gabin',
  udid: 'UDID-1',
  available: true,
  ...over,
});

const iface = (address: string, internal: boolean): os.NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal }) as os.NetworkInterfaceInfo;

console.log('\nparseFlags');

test('sans argument : debug sur le backend local', () => {
  assert.deepStrictEqual(parseFlags([]), {
    mode: 'debug',
    backend: 'local',
    device: undefined,
    clean: false,
  });
});

test('--release bascule sur staging par defaut', () => {
  const options = parseFlags(['--release']);
  assert.strictEqual(options.mode, 'release');
  assert.strictEqual(options.backend, 'staging');
});

test('--staging en debug reste en debug', () => {
  const options = parseFlags(['--staging']);
  assert.strictEqual(options.mode, 'debug');
  assert.strictEqual(options.backend, 'staging');
});

test('--release --local est refuse avec une explication', () => {
  assert.throws(
    () => parseFlags(['--release', '--local']),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /sans ton Mac/);
      return true;
    },
  );
});

test('--device prend la valeur suivante', () => {
  assert.strictEqual(parseFlags(['--device', 'iPhone de Gabin']).device, 'iPhone de Gabin');
});

test('--device sans valeur est refuse', () => {
  assert.throws(() => parseFlags(['--device']), UsageError);
  assert.throws(() => parseFlags(['--device', '--clean']), UsageError);
});

test('une option inconnue est refusee plutot qu-ignoree', () => {
  assert.throws(() => parseFlags(['--simulator']), UsageError);
});

test('--clean se combine avec le reste', () => {
  const options = parseFlags(['--clean', '--staging']);
  assert.strictEqual(options.clean, true);
  assert.strictEqual(options.backend, 'staging');
});

console.log('\ndetectLanIp');

test('retient la premiere IPv4 non-interne', () => {
  const ip = detectLanIp({
    lo0: [iface('127.0.0.1', true)],
    en0: [iface('192.168.1.42', false)],
  });
  assert.strictEqual(ip, '192.168.1.42');
});

test('ignore les interfaces internes', () => {
  assert.throws(() => detectLanIp({ lo0: [iface('127.0.0.1', true)] }), UsageError);
});

test('sans aucune interface : erreur qui renvoie vers --staging', () => {
  assert.throws(
    () => detectLanIp({}),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /--staging/);
      return true;
    },
  );
});

console.log('\nresolveEnv');

test('backend local : URL formee avec l-IP LAN et le port du backend', () => {
  const env = resolveEnv(parseFlags([]), '192.168.1.42');
  assert.strictEqual(env.EXPO_PUBLIC_API_URL, 'http://192.168.1.42:3000/api/v1');
  assert.strictEqual(env.EXPO_PUBLIC_APP_ENV, 'development');
});

test('backend staging : URL staging, IP ignoree', () => {
  const env = resolveEnv(parseFlags(['--staging']), '192.168.1.42');
  assert.strictEqual(env.EXPO_PUBLIC_API_URL, 'https://api-staging.ffd.gabin-simond.fr/api/v1');
});

test('la variante est toujours development, quel que soit le backend', () => {
  for (const argv of [[], ['--staging'], ['--release']]) {
    assert.strictEqual(resolveEnv(parseFlags(argv), '10.0.0.1').EXPO_PUBLIC_APP_ENV, 'development');
  }
});

console.log('\nparseDevices');

// Forme reelle de `xcrun devicectl list devices --json-output`, reduite aux
// champs lus. Valeurs synthetiques.
const DEVICECTL_JSON = JSON.stringify({
  result: {
    devices: [
      {
        hardwareProperties: { udid: 'UDID-1' },
        deviceProperties: { name: 'iPhone connecte' },
        connectionProperties: { tunnelState: 'connected' },
      },
      {
        hardwareProperties: { udid: 'UDID-2' },
        deviceProperties: { name: 'iPhone verrouille' },
        connectionProperties: { tunnelState: 'unavailable' },
      },
    ],
  },
});

test('lit nom, udid et disponibilite', () => {
  const devices = parseDevices(DEVICECTL_JSON);
  assert.strictEqual(devices.length, 2);
  assert.deepStrictEqual(devices[0], {
    name: 'iPhone connecte',
    udid: 'UDID-1',
    available: true,
  });
  assert.strictEqual(devices[1].available, false, 'tunnelState unavailable => indisponible');
});

test('ignore une entree sans udid ou sans nom plutot que de planter', () => {
  const json = JSON.stringify({
    result: { devices: [{ deviceProperties: { name: 'sans udid' } }, {}] },
  });
  assert.deepStrictEqual(parseDevices(json), []);
});

test('sortie vide : liste vide', () => {
  assert.deepStrictEqual(parseDevices('{}'), []);
});

console.log('\nselectDevice');

test('un seul appareil disponible : pris sans demander', () => {
  assert.deepStrictEqual(selectDevice([device()]), device());
});

test('plusieurs disponibles : demande a l-utilisateur', () => {
  assert.strictEqual(selectDevice([device(), device({ name: 'iPad', udid: 'UDID-2' })]), 'ask');
});

test('les indisponibles ne comptent pas dans le choix', () => {
  const devices = [device(), device({ name: 'iPad', udid: 'UDID-2', available: false })];
  assert.deepStrictEqual(selectDevice(devices), device());
});

test('aucun appareil : message qui dit quoi faire', () => {
  assert.throws(
    () => selectDevice([]),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /Faire confiance/);
      return true;
    },
  );
});

test('appaire mais verrouille : le message le dit, et nomme l-appareil', () => {
  assert.throws(
    () => selectDevice([device({ available: false })]),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /iPhone de Gabin/);
      assert.match(error.message, /indisponibles/);
      return true;
    },
  );
});

test('--device par nom ou par udid', () => {
  assert.deepStrictEqual(selectDevice([device()], 'iPhone de Gabin'), device());
  assert.deepStrictEqual(selectDevice([device()], 'UDID-1'), device());
});

test('--device inconnu : liste ce qui est connu', () => {
  assert.throws(
    () => selectDevice([device()], 'iPhone de quelqu-un-dautre'),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /Connus : iPhone de Gabin/);
      return true;
    },
  );
});

test('--device sur un appareil verrouille : refuse explicitement', () => {
  assert.throws(
    () => selectDevice([device({ available: false })], 'iPhone de Gabin'),
    /deverrouille-le/,
  );
});

console.log(
  failures === 0 ? '\n✅ Tous les tests passent\n' : `\n❌ ${String(failures)} test(s) en echec\n`,
);
process.exit(failures === 0 ? 0 : 1);
