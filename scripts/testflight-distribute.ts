/**
 * Distribue un build iOS deja envoye a App Store Connect aux testeurs EXTERNES
 * de TestFlight, sans plan EAS payant.
 *
 *   pnpm testflight:distribute --build-number 17
 *   pnpm testflight:distribute --build-number 17 --notes-file beta-notes.txt
 *   pnpm testflight:distribute --build-number 17 --group "Beta FFD" --timeout 60
 *   pnpm testflight:distribute --build-number 17 --dry-run
 *
 * Etapes, via l'API App Store Connect :
 *   1. attendre que le build soit traite par Apple (processingState VALID) ;
 *   2. poser les notes « What to Test » (si --notes-file) ;
 *   3. ajouter le build au groupe externe ;
 *   4. le soumettre a la Beta App Review (sauf s'il l'est deja).
 *
 * Pourquoi : `eas submit --groups` ne vise que les groupes INTERNES, et le job
 * `testflight` des EAS Workflows qui gere les groupes externes exige un plan
 * payant. L'API App Store Connect fait la meme chose avec une simple cle API.
 *
 * Auth : cle API App Store Connect (role App Manager), JWT ES256. Variables :
 *   ASC_KEY_ID     Key ID (App Store Connect → Utilisateurs et acces → Integrations)
 *   ASC_ISSUER_ID  Issuer ID (meme page)
 *   ASC_KEY_P8     contenu du fichier .p8, en clair
 *   ASC_APP_ID     App ID numerique de l'app (beta : 6787383066, cf. eas.json)
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const POLL_INTERVAL_MS = 60_000;

export interface Options {
  buildNumber: string;
  group: string;
  notesFile?: string;
  locale: string;
  timeoutMin: number;
  dryRun: boolean;
}

export interface AscBuild {
  id: string;
  version: string;
  processingState: string;
}

export function parseFlags(argv: string[]): Options {
  const options: Options = {
    buildNumber: '',
    group: 'Beta FFD',
    locale: 'fr-FR',
    timeoutMin: 60,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} attend une valeur`);
      return next;
    };
    if (flag === '--build-number') options.buildNumber = value();
    else if (flag === '--group') options.group = value();
    else if (flag === '--notes-file') options.notesFile = value();
    else if (flag === '--locale') options.locale = value();
    else if (flag === '--timeout') options.timeoutMin = Number(value());
    else if (flag === '--dry-run') options.dryRun = true;
    else throw new Error(`Option inconnue : ${flag}`);
  }
  if (!/^\d+$/.test(options.buildNumber)) {
    throw new Error('--build-number est obligatoire (numero de build iOS, ex. 17)');
  }
  if (!Number.isFinite(options.timeoutMin) || options.timeoutMin <= 0) {
    throw new Error('--timeout doit etre un nombre de minutes positif');
  }
  return options;
}

/** Le build portant ce numero dans une reponse GET /builds, ou null. */
export function findBuild(response: unknown, buildNumber: string): AscBuild | null {
  const data = (response as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    const build = item as { id?: string; attributes?: Record<string, unknown> };
    const version = String(build.attributes?.version ?? '');
    if (build.id && version === buildNumber) {
      return {
        id: build.id,
        version,
        processingState: String(build.attributes?.processingState ?? 'UNKNOWN'),
      };
    }
  }
  return null;
}

/** ready : distribuable ; wait : Apple traite encore ; fail : rejete au traitement. */
export function processingVerdict(build: AscBuild | null): 'ready' | 'wait' | 'fail' {
  if (!build) return 'wait'; // pas encore visible dans App Store Connect
  if (build.processingState === 'VALID') return 'ready';
  if (build.processingState === 'FAILED' || build.processingState === 'INVALID') return 'fail';
  return 'wait';
}

/** Id du groupe dont le nom correspond exactement, ou null. */
export function findGroupId(response: unknown, name: string): string | null {
  const data = (response as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return null;
  const match = data.find(
    (item) => (item as { attributes?: { name?: string } }).attributes?.name === name,
  ) as { id?: string } | undefined;
  return match?.id ?? null;
}

/** « What to Test » est limite a 4000 caracteres par App Store Connect. */
export function normalizeNotes(raw: string): string {
  return raw.trim().slice(0, 4000);
}

export function addToGroupBody(buildId: string) {
  return { data: [{ type: 'builds', id: buildId }] };
}

export function reviewSubmissionBody(buildId: string) {
  return {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  };
}

/** JWT ES256 signe avec la cle .p8. ieee-p1363 = format JOSE (r||s). */
function makeToken(keyId: string, issuerId: string, p8: string): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({
    iss: issuerId,
    iat: now,
    exp: now + 15 * 60, // App Store Connect : 20 min max
    aud: 'appstoreconnect-v1',
  })}`;
  const signer = createSign('SHA256');
  signer.update(input);
  return `${input}.${signer.sign({ key: p8, dsaEncoding: 'ieee-p1363' }, 'base64url')}`;
}

function client() {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const p8 = process.env.ASC_KEY_P8;
  const appId = process.env.ASC_APP_ID;
  if (!keyId || !issuerId || !p8 || !appId) {
    throw new Error('Cle ASC absente : ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 et ASC_APP_ID requis');
  }
  // Un token par appel : l'attente du traitement depasse la duree de vie d'un JWT.
  const api = async (pathname: string, init: RequestInit = {}) => {
    const res = await fetch(`${API}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${makeToken(keyId, issuerId, p8)}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(
        `ASC ${init.method ?? 'GET'} ${pathname} → ${res.status}: ${await res.text()}`,
      );
    }
    return res.status === 204 ? null : ((await res.json()) as unknown);
  };
  return { api, appId };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBuild(
  api: ReturnType<typeof client>['api'],
  appId: string,
  options: Options,
): Promise<AscBuild> {
  const deadline = Date.now() + options.timeoutMin * 60_000;
  for (;;) {
    const response = await api(
      `/builds?filter[app]=${appId}&filter[version]=${options.buildNumber}&limit=5`,
    );
    const build = findBuild(response, options.buildNumber);
    const verdict = processingVerdict(build);
    if (verdict === 'ready' && build) return build;
    if (verdict === 'fail') {
      throw new Error(`Build ${options.buildNumber} rejete par Apple (${build?.processingState})`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Build ${options.buildNumber} toujours pas pret apres ${options.timeoutMin} min ` +
          `(etat : ${build?.processingState ?? 'introuvable'})`,
      );
    }
    console.log(
      `… build ${options.buildNumber} : ${build?.processingState ?? 'pas encore visible'}`,
    );
    await sleep(POLL_INTERVAL_MS);
  }
}

async function setNotes(
  api: ReturnType<typeof client>['api'],
  buildId: string,
  locale: string,
  whatsNew: string,
): Promise<void> {
  const locs = (await api(`/builds/${buildId}/betaBuildLocalizations`)) as {
    data?: { id: string; attributes?: { locale?: string } }[];
  };
  const existing = locs.data?.find((l) => l.attributes?.locale === locale);
  if (existing) {
    await api(`/betaBuildLocalizations/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew } },
      }),
    });
  } else {
    await api('/betaBuildLocalizations', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale, whatsNew },
          relationships: { build: { data: { type: 'builds', id: buildId } } },
        },
      }),
    });
  }
}

async function main(): Promise<void> {
  const options = parseFlags(process.argv.slice(2));
  const notes = options.notesFile ? normalizeNotes(readFileSync(options.notesFile, 'utf8')) : '';
  const { api, appId } = client();

  const groups = await api(`/apps/${appId}/betaGroups?limit=200`);
  const groupId = findGroupId(groups, options.group);
  if (!groupId) {
    throw new Error(`Groupe TestFlight « ${options.group} » introuvable pour l'app ${appId}`);
  }

  console.log(`→ Attente du traitement Apple du build ${options.buildNumber}…`);
  const build = await waitForBuild(api, appId, options);
  console.log(`✓ Build ${build.version} pret (${build.id})`);

  if (options.dryRun) {
    console.log(
      `(--dry-run) : notes=${notes ? 'oui' : 'non'}, groupe=${options.group}, review=oui`,
    );
    return;
  }

  if (notes) {
    await setNotes(api, build.id, options.locale, notes);
    console.log(`✓ « What to Test » renseigne (${options.locale})`);
  }

  await api(`/betaGroups/${groupId}/relationships/builds`, {
    method: 'POST',
    body: JSON.stringify(addToGroupBody(build.id)),
  });
  console.log(`✓ Ajoute au groupe « ${options.group} »`);

  const existing = (await api(`/builds/${build.id}/betaAppReviewSubmission`)) as {
    data?: { attributes?: { betaReviewState?: string } } | null;
  };
  if (existing?.data) {
    console.log(
      `✓ Deja soumis a la Beta App Review (${existing.data.attributes?.betaReviewState})`,
    );
    return;
  }
  await api('/betaAppReviewSubmissions', {
    method: 'POST',
    body: JSON.stringify(reviewSubmissionBody(build.id)),
  });
  console.log('✓ Soumis a la Beta App Review');
}

// Pas d'execution a l'import : le fichier de test importe les fonctions pures.
if (process.argv[1] && process.argv[1].endsWith('testflight-distribute.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
