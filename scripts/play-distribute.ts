/**
 * Pose les notes de version d'un build Android deja envoye sur une piste Google
 * Play (test ferme), pendant de `testflight-distribute` cote iOS.
 *
 *   pnpm play:distribute --version-code 12
 *   pnpm play:distribute --version-code 12 --notes-file beta-notes.txt
 *   pnpm play:distribute --version-code 12 --track alpha --timeout 30
 *   pnpm play:distribute --version-code 12 --dry-run
 *
 * Etapes, via l'API Google Play Developer (v3, « edits ») :
 *   1. attendre que la release portant ce versionCode soit sur la piste
 *      (`eas submit` l'y depose) ;
 *   2. y poser les notes de version (si --notes-file), langue fr-FR ;
 *   3. valider la modification (commit).
 *
 * La publication sur la piste elle-meme est faite par `eas submit`
 * (submit.beta.android d'eas.json : piste `alpha`, releaseStatus `completed`) :
 * ce script ne change ni le statut ni les versionCodes de la release.
 *
 * Auth : compte de service Google, droits de publication sur les pistes de
 * test de l'app. Variables :
 *   PLAY_SERVICE_ACCOUNT_JSON  contenu de la cle JSON du compte de service
 *   PLAY_PACKAGE_NAME          optionnel (defaut fr.ffdanse.connect.beta)
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const POLL_INTERVAL_MS = 60_000;
/** Limite Google Play des notes de version, par langue. */
export const PLAY_NOTES_MAX = 500;

export interface Options {
  versionCode: string;
  track: string;
  notesFile?: string;
  language: string;
  timeoutMin: number;
  dryRun: boolean;
}

export interface PlayRelease {
  name?: string;
  versionCodes?: string[];
  status?: string;
  releaseNotes?: { language: string; text: string }[];
  [key: string]: unknown;
}

export interface PlayTrack {
  track: string;
  releases?: PlayRelease[];
}

export function parseFlags(argv: string[]): Options {
  const options: Options = {
    versionCode: '',
    track: 'alpha',
    language: 'fr-FR',
    timeoutMin: 30,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} attend une valeur`);
      return next;
    };
    if (flag === '--version-code') options.versionCode = value();
    else if (flag === '--track') options.track = value();
    else if (flag === '--notes-file') options.notesFile = value();
    else if (flag === '--language') options.language = value();
    else if (flag === '--timeout') options.timeoutMin = Number(value());
    else if (flag === '--dry-run') options.dryRun = true;
    else throw new Error(`Option inconnue : ${flag}`);
  }
  if (!/^\d+$/.test(options.versionCode)) {
    throw new Error('--version-code est obligatoire (versionCode Android, ex. 12)');
  }
  if (!Number.isFinite(options.timeoutMin) || options.timeoutMin <= 0) {
    throw new Error('--timeout doit etre un nombre de minutes positif');
  }
  return options;
}

/** La release de la piste qui contient ce versionCode, ou null. */
export function findRelease(track: PlayTrack, versionCode: string): PlayRelease | null {
  return (track.releases ?? []).find((r) => (r.versionCodes ?? []).includes(versionCode)) ?? null;
}

/**
 * La piste a renvoyer, avec les notes posees sur la seule release qui porte ce
 * versionCode. Les autres releases (et les autres langues de celle-ci) restent
 * telles quelles.
 */
export function withNotes(
  track: PlayTrack,
  versionCode: string,
  language: string,
  text: string,
): PlayTrack {
  return {
    track: track.track,
    releases: (track.releases ?? []).map((release) => {
      if (!(release.versionCodes ?? []).includes(versionCode)) return release;
      const others = (release.releaseNotes ?? []).filter((n) => n.language !== language);
      return { ...release, releaseNotes: [...others, { language, text }] };
    }),
  };
}

/**
 * Notes au format de Google Play : 500 caracteres maximum. Coupe a la fin
 * d'une ligne entiere plutot qu'au milieu d'une phrase, et le signale par « … ».
 * Les memes notes (format `testflight`) servent aux deux stores.
 */
export function normalizeNotes(raw: string): string {
  const text = raw.trim();
  if (text.length <= PLAY_NOTES_MAX) return text;
  const room = PLAY_NOTES_MAX - 2; // "\n…"
  let kept = '';
  for (const line of text.split('\n')) {
    const next = kept ? `${kept}\n${line}` : line;
    if (next.length > room) break;
    kept = next;
  }
  if (!kept) kept = text.slice(0, room);
  return `${kept.trimEnd()}\n…`;
}

/** Message d'erreur Google lisible et borne (error.status / error.message). */
export function describeGoogleError(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: { status?: string; message?: string } }).error;
    if (error) return [error.status, error.message].filter(Boolean).join(' — ').slice(0, 500);
  } catch {
    // corps non JSON : on retombe sur le texte brut
  }
  return body.slice(0, 500);
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Jeton OAuth du compte de service (JWT RS256 echange contre un access token). */
async function accessToken(account: ServiceAccount): Promise<string> {
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: account.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const assertion = `${input}.${signer.sign(account.private_key, 'base64url')}`;
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Jeton Google refuse → ${res.status}: ${describeGoogleError(await res.text())}`,
    );
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

function client() {
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Cle Google absente : PLAY_SERVICE_ACCOUNT_JSON requis');
  let account: ServiceAccount;
  try {
    account = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON n'est pas un JSON valide");
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON sans client_email ou private_key');
  }
  const packageName = process.env.PLAY_PACKAGE_NAME ?? 'fr.ffdanse.connect.beta';
  let token: string | null = null;
  const api = async (pathname: string, init: RequestInit = {}) => {
    token ??= await accessToken(account);
    const res = await fetch(`${API}/${packageName}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `Play ${init.method ?? 'GET'} ${pathname} → ${res.status}: ${describeGoogleError(await res.text())}`,
      );
    }
    return res.status === 204 ? null : ((await res.json()) as unknown);
  };
  return { api, packageName };
}

type Api = ReturnType<typeof client>['api'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ouvre une modification, la passe a `fn`, l'abandonne si `fn` echoue. */
async function inEdit<T>(api: Api, fn: (editId: string) => Promise<T>): Promise<T> {
  const edit = (await api('/edits', { method: 'POST', body: '{}' })) as { id: string };
  try {
    return await fn(edit.id);
  } catch (error) {
    await api(`/edits/${edit.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
}

/** Piste lue dans une modification aussitot abandonnee (lecture seule). */
async function readTrack(api: Api, track: string): Promise<PlayTrack> {
  return inEdit(api, async (editId) => {
    const result = (await api(`/edits/${editId}/tracks/${track}`)) as PlayTrack;
    await api(`/edits/${editId}`, { method: 'DELETE' });
    return result;
  });
}

async function waitForRelease(api: Api, options: Options): Promise<void> {
  const deadline = Date.now() + options.timeoutMin * 60_000;
  for (;;) {
    // Une modification est un instantane : en rouvrir une a chaque tour.
    if (findRelease(await readTrack(api, options.track), options.versionCode)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `versionCode ${options.versionCode} toujours absent de la piste ${options.track} ` +
          `apres ${options.timeoutMin} min`,
      );
    }
    console.log(`… versionCode ${options.versionCode} : pas encore sur la piste ${options.track}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const options = parseFlags(process.argv.slice(2));
  const notes = options.notesFile ? normalizeNotes(readFileSync(options.notesFile, 'utf8')) : '';
  const { api, packageName } = client();

  console.log(
    `→ Attente du versionCode ${options.versionCode} sur ${packageName}/${options.track}…`,
  );
  await waitForRelease(api, options);
  console.log(`✓ Release presente sur la piste ${options.track}`);

  if (options.dryRun) {
    console.log(`(--dry-run) : notes=${notes ? `${notes.length} car.` : 'non'}`);
    return;
  }
  if (!notes) {
    console.log('Pas de --notes-file : rien a modifier.');
    return;
  }

  await inEdit(api, async (editId) => {
    const track = (await api(`/edits/${editId}/tracks/${options.track}`)) as PlayTrack;
    await api(`/edits/${editId}/tracks/${options.track}`, {
      method: 'PUT',
      body: JSON.stringify(withNotes(track, options.versionCode, options.language, notes)),
    });
    await api(`/edits/${editId}:commit`, { method: 'POST' });
  });
  console.log(`✓ Notes de version renseignees (${options.language}, ${notes.length} car.)`);
}

// Pas d'execution a l'import : le fichier de test importe les fonctions pures.
if (process.argv[1] && process.argv[1].endsWith('play-distribute.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
