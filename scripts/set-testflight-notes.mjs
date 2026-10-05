#!/usr/bin/env node
/**
 * Pousse les notes « What to Test » sur le dernier build TestFlight via l'API
 * App Store Connect. Appelé par le job promote-beta APRÈS `eas build
 * --auto-submit`.
 *
 * Auth : clé API App Store Connect (JWT ES256). Secrets attendus en env :
 *   ASC_KEY_ID     Key ID de la clé API (App Store Connect → Users & Access → Keys)
 *   ASC_ISSUER_ID  Issuer ID (même page)
 *   ASC_KEY_P8     Contenu du fichier .p8 (clé privée EC), en clair
 *   ASC_APP_ID     App ID App Store Connect (numérique)
 *
 * Usage : node scripts/set-testflight-notes.mjs --notes-file beta-notes.txt
 *                                              [--locale fr-FR]
 *
 * NON-FATAL par conception : toute erreur est loguée et le script sort en 0 —
 * un échec de notes ne doit jamais faire échouer une promotion beta déjà
 * soumise avec succès.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function warn(msg) {
  process.stderr.write(`⚠️  [testflight-notes] ${msg}\n`);
}

/** JWT ES256 signé avec la clé .p8. dsaEncoding ieee-p1363 = format JOSE (r||s). */
function makeToken({ keyId, issuerId, p8 }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 15 * 60, // ASC : 20 min max
    aud: 'appstoreconnect-v1',
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({ key: p8, dsaEncoding: 'ieee-p1363' }, 'base64url');
  return `${signingInput}.${signature}`;
}

async function api(token, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ASC ${options.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const notesFile = arg('notes-file');
  const locale = arg('locale', 'fr-FR');
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const p8 = process.env.ASC_KEY_P8;
  const appId = process.env.ASC_APP_ID;

  if (!keyId || !issuerId || !p8 || !appId) {
    warn('clé ASC absente (ASC_KEY_ID/ISSUER_ID/KEY_P8/APP_ID) — étape ignorée.');
    return;
  }
  if (!notesFile) {
    warn('--notes-file manquant — étape ignorée.');
    return;
  }

  const whatsNew = readFileSync(notesFile, 'utf8').trim().slice(0, 4000);
  if (!whatsNew) {
    warn('notes vides — rien à publier.');
    return;
  }

  const token = makeToken({ keyId, issuerId, p8 });

  // 1. Dernier build uploadé pour l'app.
  const builds = await api(token, `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1`);
  const build = builds.data?.[0];
  if (!build) {
    warn("aucun build trouvé pour l'app — étape ignorée.");
    return;
  }
  const buildId = build.id;

  // 2. Localisations beta existantes pour ce build.
  const locs = await api(token, `/builds/${buildId}/betaBuildLocalizations`);
  const existing = (locs.data || []).find((l) => l.attributes?.locale === locale);

  if (existing) {
    // 3a. Mise à jour.
    await api(token, `/betaBuildLocalizations/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'betaBuildLocalizations',
          id: existing.id,
          attributes: { whatsNew },
        },
      }),
    });
  } else {
    // 3b. Création.
    await api(token, `/betaBuildLocalizations`, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale, whatsNew },
          relationships: {
            build: { data: { type: 'builds', id: buildId } },
          },
        },
      }),
    });
  }

  process.stdout.write(`✅ Notes TestFlight publiées sur le build ${buildId} (${locale}).\n`);
}

main().catch((err) => {
  // Non-fatal : on ne casse pas une promotion réussie pour un souci de notes.
  warn(err.message || String(err));
  warn("les notes restent disponibles dans le résumé du job + l'artifact.");
  process.exit(0);
});
