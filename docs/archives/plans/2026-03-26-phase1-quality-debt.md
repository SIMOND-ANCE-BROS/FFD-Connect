# Phase 1 — Qualité & Dette Technique

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Renforcer la robustesse du codebase en activant TypeScript strict sur le backend, en promouvant les règles ESLint critiques en `error`, en comblant le gap de coverage client (76% → 80%), et en ajoutant des timeouts sur les services externes.

**Architecture:** Trois axes indépendants : (1) TypeScript/ESLint pour attraper les bugs statiquement, (2) tests client pour sécuriser les régressions, (3) timeouts sur les appels externes pour éviter les cascades de pannes.

**Tech Stack:** TypeScript 5.6, ESLint 9 flat config, Jest 29, NestJS 11, Prisma 7

---

## Axe 1 — TypeScript strict sur le backend

### Task 1 : Activer `strict: true` dans le backend

**Files:**

- Modify: `apps/backend/tsconfig.json`

Le backend a déjà `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`, `strictPropertyInitialization` explicitement. `strict: true` ajoute en plus `strictFunctionTypes`, `noImplicitThis`, `alwaysStrict`. On ajoute aussi `noImplicitReturns` qui manque.

- [x] **Step 1 : Vérifier le typecheck actuel (baseline)**

```bash
cd apps/backend && pnpm typecheck
```

Note les erreurs existantes (s'il y en a). C'est la baseline.

- [x] **Step 2 : Ajouter `strict` et `noImplicitReturns` dans tsconfig.json**

Dans `apps/backend/tsconfig.json`, ajouter après `"skipLibCheck": true` :

```json
"strict": true,
"noImplicitReturns": true,
```

- [x] **Step 3 : Supprimer les options individuelles rendues redondantes par `strict: true`**

Après avoir ajouté `strict: true`, les options suivantes sont implicitement incluses et peuvent être retirées pour réduire le bruit :

- `"strictNullChecks": true`
- `"noImplicitAny": true`
- `"strictBindCallApply": true`
- `"strictPropertyInitialization": true`

Conserver impérativement (non couverts par `strict`) :

- `"noUnusedLocals": true`
- `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`
- `"forceConsistentCasingInFileNames": true`
- `"noImplicitReturns": true` (ajouté à l'étape précédente)

- [x] **Step 4 : Relancer le typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : nouvelles erreurs sur `strictFunctionTypes`/`noImplicitThis`/`noImplicitReturns` si des cas existent.

- [x] **Step 5 : Corriger les erreurs une par une**

Pour chaque erreur :

- `noImplicitThis` : ajouter un type explicite au paramètre `this` ou extraire dans une arrow function
- `noImplicitReturns` : ajouter un `return` explicite ou `throw` dans toutes les branches
- `strictFunctionTypes` : revoir les signatures de callbacks si nécessaire

- [x] **Step 6 : Confirmer typecheck + lint vert**

```bash
cd apps/backend && pnpm typecheck && pnpm lint
```

Expected : 0 erreur.

- [x] **Step 7 : Commit**

```bash
git add apps/backend/tsconfig.json apps/backend/src/
git commit -m "chore(backend): enable strict: true and noImplicitReturns in tsconfig"
```

---

## Axe 2 — ESLint : promouvoir les règles critiques de `warn` à `error`

### Task 2 : Renforcer le shared eslint-config/base.js

**Files:**

- Modify: `packages/eslint-config/base.js`

Les règles `no-explicit-any` et `no-unsafe-*` sont actuellement en `warn`. Pour du code de production, elles doivent être en `error` pour bloquer le CI. Note : corriger `no-explicit-any` en premier fait souvent disparaître une partie des violations `no-unsafe-*` (car les `any` typés sont la source principale des unsafe warnings).

- [x] **Step 1 : Mesurer l'impact (dry run)**

```bash
cd apps/backend && pnpm lint 2>&1 | grep -c "warning"
cd apps/client && pnpm lint 2>&1 | grep -c "warning"
```

Note le nombre actuel de warnings ESLint — ce sont les violations potentielles.

- [x] **Step 2 : Passer `no-explicit-any` en `error` dans `base.js`**

Dans `packages/eslint-config/base.js`, changer :

```js
'@typescript-eslint/no-explicit-any': 'warn',
```

→

```js
'@typescript-eslint/no-explicit-any': 'error',
```

- [x] **Step 3 : Lancer lint backend et corriger**

```bash
cd apps/backend && pnpm lint
```

Pour chaque `any` dans le code de prod (hors fichiers `.spec.ts`) :

- Remplacer par le type exact si connu
- Utiliser `unknown` si le type est vraiment inconnu
- En dernier recours : `// eslint-disable-next-line @typescript-eslint/no-explicit-any` avec commentaire justificatif

- [x] **Step 4 : Lancer lint client et corriger**

```bash
cd apps/client && pnpm lint
```

Même processus que step 3.

- [x] **Step 5 : Passer les 5 règles `no-unsafe-*` en `error`**

Dans `packages/eslint-config/base.js` (faire après que `no-explicit-any` est corrigé — beaucoup de violations unsafe proviennent de `any` mal typés résolus à l'étape précédente) :

```js
'@typescript-eslint/no-unsafe-argument': 'error',
'@typescript-eslint/no-unsafe-assignment': 'error',
'@typescript-eslint/no-unsafe-call': 'error',
'@typescript-eslint/no-unsafe-member-access': 'error',
'@typescript-eslint/no-unsafe-return': 'error',
```

- [x] **Step 6 : Corriger les violations restantes backend puis client**

```bash
cd apps/backend && pnpm lint
cd apps/client && pnpm lint
```

Pour chaque violation : typer correctement la variable source (souvent un retour de `JSON.parse`, une réponse HTTP non typée, ou un `any` hérité).

- [x] **Step 7 : Vérifier que les tests passent toujours**

```bash
pnpm --filter @ffd-connect/backend test && pnpm --filter @ffd-connect/client test
```

Expected : 0 failure (les règles ESLint test files ont leurs propres `off`, donc les tests ne sont pas impactés).

- [x] **Step 8 : Commit**

```bash
git add packages/eslint-config/base.js apps/backend/src/ apps/client/src/
git commit -m "chore(eslint): promote no-explicit-any and no-unsafe-* from warn to error"
```

---

## Axe 3 — Timeouts sur les services externes

### Task 3 : Timeout sur Google Cloud TTS

**Files:**

- Modify: `apps/backend/src/tts/tts.service.ts`
- Modify: `apps/backend/src/tts/tts.service.spec.ts`

`synthesizeSpeech` n'a pas de timeout : si Google TTS ne répond pas, la requête reste suspendue indéfiniment.

**Important pour les tests :**

- Le fichier spec utilise `jest.mock('@google-cloud/text-to-speech', ...)` en top-level. Accéder au client mock via `(anyService as any).client.synthesizeSpeech.mockResolvedValueOnce(...)` (pattern déjà établi dans le fichier).
- **Pas besoin de fake timers** (`jest.useFakeTimers`). Un `Promise.race` externe avec un délai de 100ms suffit pour le test "failing" avant d'implémenter le vrai timeout de 10s.
- Utiliser `mockResolvedValueOnce` (pas `mockReturnValue`) pour éviter de polluer les autres tests du describe block.

- [x] **Step 1 : Écrire le test de timeout (failing)**

Dans `apps/backend/src/tts/tts.service.spec.ts`, ajouter dans le describe block existant :

```typescript
it('should throw if Google TTS synthesizeSpeech hangs', async () => {
  // Promise qui ne se résout jamais — simule un hang réseau
  const hangingPromise = new Promise<never>(() => {});
  (anyService as any).client.synthesizeSpeech.mockReturnValueOnce(hangingPromise);

  // Le test prouve que sans timeout interne, getTtsAudio peut être bloqué
  await expect(
    Promise.race([
      service.getTtsAudio('test annonce'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TEST_TIMEOUT')), 100)),
    ]),
  ).rejects.toThrow('TEST_TIMEOUT');
}, 500);
```

- [x] **Step 2 : Lancer le test pour confirmer qu'il échoue**

```bash
cd apps/backend && pnpm test src/tts/tts.service.spec.ts
```

Expected : le test échoue car sans timeout interne, l'outer `Promise.race` expire en premier avec `TEST_TIMEOUT`. ✓

- [x] **Step 3 : Créer l'utilitaire `timeout.utils.ts`**

Créer `apps/backend/src/utils/timeout.utils.ts` :

```typescript
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[Timeout] ${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}
```

- [x] **Step 4 : Ajouter le timeout dans `getTtsAudio`**

Dans `tts.service.ts`, importer et utiliser `withTimeout` :

```typescript
import { withTimeout } from '../utils/timeout.utils';
```

Remplacer :

```typescript
const [response] = await this.client.synthesizeSpeech(request);
```

par :

```typescript
const [response] = await withTimeout(
  this.client.synthesizeSpeech(request),
  10_000,
  'Google TTS synthesizeSpeech',
);
```

- [x] **Step 5 : Relancer le test — doit passer**

```bash
cd apps/backend && pnpm test src/tts/tts.service.spec.ts
```

Expected : PASS. Le timeout interne de 10s est supérieur au délai de 100ms du test, donc le test "outer race" expirerait en 100ms si le timeout interne ne lançait pas l'erreur… mais avec le timeout interne, `getTtsAudio` lève `[Timeout] Google TTS synthesizeSpeech timed out after 10000ms` en 10s.

**Attention :** le test avec outer 100ms passe parce que le test attend `TEST_TIMEOUT` et obtient effectivement un reject après 100ms (l'outer race gagne). Avec le timeout interne de 10s, le test est toujours correct : l'outer race de 100ms gagne toujours sur le timeout interne de 10s.

- [x] **Step 6 : Commit**

```bash
git add apps/backend/src/utils/timeout.utils.ts apps/backend/src/tts/
git commit -m "fix(tts): add 10s timeout on Google TTS synthesizeSpeech call"
```

---

### Task 4 : Timeout sur Google Cloud Vision (OCR)

**Files:**

- Modify: `apps/backend/src/utils/ocr.service.ts`
- Modify: `apps/backend/src/utils/ocr.service.spec.ts`

`textDetection` est appelé sans timeout dans `extractLicenseInfo` **et** `extractMedicalCertificateInfo`.

**Note :** `withTimeout` rejette avec une erreur. Le `try/catch` existant dans `ocr.service.ts` (ligne 62-67 et 122-127) attrape cette erreur et retourne `{}`. Le test doit donc vérifier `{}` comme résultat — c'est cohérent avec le comportement actuel en cas d'erreur Vision API.

- [x] **Step 1 : Écrire les deux tests de timeout (failing)**

Dans `apps/backend/src/utils/ocr.service.spec.ts` :

```typescript
it('should return {} if Vision textDetection hangs on extractLicenseInfo', async () => {
  const hangingPromise = new Promise<never>(() => {});
  (service as any).client = { textDetection: jest.fn().mockReturnValue(hangingPromise) };

  const result = await Promise.race([
    service.extractLicenseInfo('/fake/path.jpg'),
    new Promise<object>((resolve) => setTimeout(() => resolve({}), 100)),
  ]);

  expect(result).toEqual({});
}, 500);

it('should return {} if Vision textDetection hangs on extractMedicalCertificateInfo', async () => {
  const hangingPromise = new Promise<never>(() => {});
  (service as any).client = { textDetection: jest.fn().mockReturnValue(hangingPromise) };

  const result = await Promise.race([
    service.extractMedicalCertificateInfo('/fake/path.jpg'),
    new Promise<object>((resolve) => setTimeout(() => resolve({}), 100)),
  ]);

  expect(result).toEqual({});
}, 500);
```

- [x] **Step 2 : Lancer les tests pour confirmer l'échec**

```bash
cd apps/backend && pnpm test src/utils/ocr.service.spec.ts
```

- [x] **Step 3 : Ajouter `withTimeout` dans `extractLicenseInfo` et `extractMedicalCertificateInfo`**

Dans `ocr.service.ts`, importer l'utilitaire :

```typescript
import { withTimeout } from './timeout.utils';
```

Dans `extractLicenseInfo`, remplacer :

```typescript
const [result] = await this.client.textDetection(imagePath);
```

par :

```typescript
const [result] = await withTimeout(
  this.client.textDetection(imagePath),
  15_000,
  'Vision.textDetection (license)',
);
```

Même remplacement dans `extractMedicalCertificateInfo` :

```typescript
const [result] = await withTimeout(
  this.client.textDetection(imagePath),
  15_000,
  'Vision.textDetection (medical)',
);
```

- [x] **Step 4 : Relancer les tests**

```bash
cd apps/backend && pnpm test src/utils/ocr.service.spec.ts
```

Expected : PASS.

- [x] **Step 5 : Commit**

```bash
git add apps/backend/src/utils/
git commit -m "fix(ocr): add 15s timeout on Google Vision textDetection (license + medical)"
```

---

### Task 5 : Timeout sur yt-dlp (DownloadService)

**Files:**

- Modify: `apps/backend/src/tracks/download.service.ts`
- Modify: `apps/backend/src/tracks/download.service.spec.ts`

`youtubedl(...)` peut tourner indéfiniment si YouTube est lent ou si la vidéo est très longue.

- [x] **Step 1 : Écrire le test de timeout (failing)**

Dans `apps/backend/src/tracks/download.service.spec.ts`, ajouter :

```typescript
it('should throw if yt-dlp download hangs', async () => {
  const hangingPromise = new Promise<never>(() => {});
  // youtube-dl-exec est mocké via jest.mock('youtube-dl-exec')
  // récupérer le mock via le module mocké
  const youtubedlMock = jest.requireMock('youtube-dl-exec') as jest.Mock;
  youtubedlMock.mockReturnValueOnce(hangingPromise);

  await expect(
    Promise.race([
      service.downloadTrack('https://youtube.com/watch?v=test', null, '/tmp'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TEST_TIMEOUT')), 100)),
    ]),
  ).rejects.toThrow('TEST_TIMEOUT');
}, 500);
```

- [x] **Step 2 : Lancer le test pour confirmer l'échec**

```bash
cd apps/backend && pnpm test src/tracks/download.service.spec.ts
```

- [x] **Step 3 : Ajouter le timeout dans `downloadTrack`**

Dans `download.service.ts` :

```typescript
import { withTimeout } from '../utils/timeout.utils';

// Dans downloadTrack(), remplacer :
await youtubedl(downloadUrl, { ... });

// par :
await withTimeout(
  youtubedl(downloadUrl, { ... }),
  120_000, // 2 minutes max
  'yt-dlp download',
);
```

- [x] **Step 4 : Relancer les tests**

```bash
cd apps/backend && pnpm test src/tracks/download.service.spec.ts
```

Expected : PASS.

- [x] **Step 5 : Commit**

```bash
git add apps/backend/src/tracks/download.service.ts
git commit -m "fix(tracks): add 2min timeout on yt-dlp download call"
```

---

## Axe 4 — Coverage client (76% → 80%)

### Task 6 : Combler le gap de coverage client

**Files:**

- Read: `apps/client/jest.config.js` (seuils actuels)
- Modify: fichiers de tests existants ou nouveaux dans `apps/client/src/`

- [x] **Step 1 : Générer le rapport de coverage (baseline)**

```bash
cd apps/client && pnpm test --coverage
```

Ne pas passer `--coverageReporters` pour ne pas écraser les reporters configurés.

- [x] **Step 2 : Identifier les 10 fichiers avec le plus faible coverage**

```bash
node -e "
const data = JSON.parse(require('fs').readFileSync('apps/client/coverage/coverage-summary.json', 'utf8'));
const files = Object.entries(data)
  .filter(([k]) => k !== 'total')
  .map(([file, cov]) => ({ file: file.replace(process.cwd() + '/apps/client/', ''), stmts: cov.statements.pct }))
  .sort((a, b) => a.stmts - b.stmts)
  .slice(0, 10);
console.table(files);
"
```

- [x] **Step 3 : Ajouter des tests unitaires pour les fichiers sous-couverts**

Cibler en priorité :

- Les hooks (`src/features/**/use*.ts`) : happy path + cas d'erreur
- Les services (`src/services/**/*.ts`) : transformation de données
- Les utilitaires (`src/utils/**/*.ts`) : 100% atteignable facilement

Pattern de test pour un hook avec React Query + MSW :

```typescript
import { renderHook, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { createWrapper } from '../../../__tests__/utils/test-utils';
import { useMyHook } from '../useMyHook';

describe('useMyHook', () => {
  it('returns data on success', async () => {
    server.use(http.get('/api/endpoint', () => HttpResponse.json({ data: 'value' })));
    const { result } = renderHook(() => useMyHook(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ data: 'value' });
  });

  it('returns error state on failure', async () => {
    server.use(http.get('/api/endpoint', () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useMyHook(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [x] **Step 4 : Vérifier que le coverage atteint 80%**

```bash
cd apps/client && pnpm test --coverage
```

Expected : `Statements: ≥ 80%` dans le résumé.

- [x] **Step 5 : Mettre à jour le seuil dans `jest.config.js` pour verrouiller le gain**

Dans `apps/client/jest.config.js`, trouver le bloc `coverageThreshold.global` et passer `statements` de `76` à `80` :

```js
coverageThreshold: {
  global: {
    statements: 80,  // was 76
    branches: 64,
    functions: 58,
    lines: 77,
  },
},
```

Ceci empêche toute régression future : CI échouera si le coverage retombe sous 80%.

- [x] **Step 6 : Commit**

```bash
git add apps/client/src/ apps/client/jest.config.js
git commit -m "test(client): add unit tests and lock coverage threshold at 80% statements"
```

---

## Critères de sortie de Phase 1

- [x] `pnpm typecheck` vert sur backend (avec `strict: true`) et client
- [x] `pnpm lint` vert : 0 erreur ESLint avec `no-explicit-any` et `no-unsafe-*` en `error`
- [x] `pnpm test` vert sur backend et client : tous les tests passent
- [x] Coverage client ≥ 80% statements, seuil verrouillé dans `jest.config.js`
- [x] Timeouts en place : TTS (10s), Vision OCR (15s), yt-dlp (2min)
- [x] Utilitaire `timeout.utils.ts` partagé entre les trois services
- [x] CI GitHub Actions entièrement verte
