# Quality Phase 2 — Tests & Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Éliminer le worker teardown non gracieux dans les tests client, augmenter la couverture de branches pour licenses (24%→70%) et competitions (43%→65%), et ajouter des tests unitaires pour les fonctions de parsing du script sync.

**Architecture:** 4 tâches indépendantes dans l'ordre : teardown client → utils script → licenses coverage → competitions coverage. Chaque tâche produit des tests qui passent et un commit.

**Tech Stack:** Jest, React Native Testing Library, NestJS Test, TypeScript strict, Prisma mocks

---

## Fichiers touchés

**Tâche 1 — Teardown**

- Modify (si coupable): `apps/client/src/hooks/__tests__/useOfflineQueue.test.ts`
- Modify (si coupable): `apps/client/jest.setup.js` ou fichiers spec identifiés par bisection

**Tâche 2 — Script utils**

- Create: `apps/backend/scripts/sync-licensees.utils.ts`
- Create: `apps/backend/scripts/sync-licensees.utils.spec.ts`
- Modify: `apps/backend/scripts/sync-licensees-from-compete.ts`

**Tâche 3 — licenses coverage**

- Modify: `apps/backend/src/licenses/licenses.service.spec.ts`
- Modify: `apps/backend/jest.config.js`

**Tâche 4 — competitions coverage**

- Modify: `apps/backend/src/competitions/competitions.service.spec.ts`
- Modify: `apps/backend/jest.config.js`

---

## Tâche 1 : Teardown — éliminer les 8 Timeout handles

**Files:**

- Investigate: `apps/client/src/hooks/__tests__/useOfflineQueue.test.ts`
- Investigate: `apps/client/jest.setup.js`
- Modify: fichier(s) identifié(s) par bisection

### Contexte

`pnpm test` dans `apps/client` affiche `A worker process has failed to exit gracefully` à chaque run. `--detectOpenHandles` révèle 8 `Timeout` handles sans stack trace. La source probable est `useOfflineQueue.test.ts` (utilise de vrais `setTimeout` avec `await new Promise((r) => setTimeout(r, 50))`) ou un timer global dans `jest.setup.js`.

- [x] **Step 1 : Isoler la suite coupable**

Lancer chaque fichier suspect individuellement avec `--detectOpenHandles` :

```bash
cd apps/client && npx jest --detectOpenHandles src/hooks/__tests__/useOfflineQueue.test.ts 2>&1 | grep -E "open handle|Timeout|force exit"
```

```bash
cd apps/client && npx jest --detectOpenHandles src/hooks/__tests__/useJobPolling.test.ts 2>&1 | grep -E "open handle|Timeout|force exit"
```

```bash
cd apps/client && npx jest --detectOpenHandles src/features/competitions/components/__tests__/TimingList.test.tsx 2>&1 | grep -E "open handle|Timeout|force exit"
```

Continuer avec d'autres fichiers si nécessaire. Noter quel(s) fichier(s) produisent le warning.

- [x] **Step 2 : Appliquer le fix selon la source**

**Si `useOfflineQueue.test.ts` est coupable** (vrais `setTimeout` dans les tests) :

Ajouter `afterAll` pour nettoyer les timers. Lire le fichier d'abord, puis ajouter après les `beforeEach` existants :

```typescript
afterAll(() => {
  jest.clearAllTimers();
});
```

Ou, si les `setTimeout(r, 50)` sont la source, les remplacer par `jest.useFakeTimers()` + `jest.runAllTimersAsync()`. Mais attention : `useOfflineQueue` utilise NetInfo dont l'implémentation peut dépendre des timers réels. Dans ce cas, envelopper uniquement les tests concernés avec `jest.useFakeTimers({ doNotFake: ["Promise"] })`.

**Si `jest.setup.js` est coupable** (timer global) :

Chercher les `setTimeout` / `setInterval` dans `jest.setup.js` et ajouter `.unref()` sur les handles retournés, ou les envelopper dans `afterAll` dans le setup global.

**Si un autre fichier est coupable** :

Ajouter dans ce fichier :

```typescript
afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
```

- [x] **Step 3 : Vérifier que le warning disparaît**

```bash
cd apps/client && pnpm test 2>&1 | grep -E "worker|force exit|open handle|Tests:"
```

Attendu : plus de ligne `A worker process has failed to exit gracefully`

- [x] **Step 4 : Vérifier que tous les tests passent toujours**

```bash
cd apps/client && pnpm test 2>&1 | tail -6
```

Attendu : `Test Suites: 95 passed` et `Tests: 784 passed`

- [x] **Step 5 : Commit**

```bash
git add apps/client/src/ apps/client/jest.setup.js
git commit -m "fix(tests): resolve 8 open Timeout handles causing worker force-exit"
```

---

## Tâche 2 : Script sync — extraction fonctions pures + tests

**Files:**

- Create: `apps/backend/scripts/sync-licensees.utils.ts`
- Create: `apps/backend/scripts/sync-licensees.utils.spec.ts`
- Modify: `apps/backend/scripts/sync-licensees-from-compete.ts`

### Contexte

4 fonctions pures existent dans `sync-licensees-from-compete.ts` aux lignes 235-285 : `normalizeForMatch`, `parseFullName`, `parseRank`, `parseClubNames`. On les extrait dans un fichier utilitaire et on les exporte pour pouvoir les tester.

- [x] **Step 1 : Créer `apps/backend/scripts/sync-licensees.utils.ts`**

```typescript
/** Remove accents for stable matching (è→e, é→e, etc.) */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Parse "First LAST" or "First LAST1 LAST2" → { firstName, lastName } */
export function parseFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const raw = fullName.trim().replace(/\s+/g, ' ');
  const parts = raw.split(' ');
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  const allCaps = parts.filter((p) => p === p.toUpperCase() && p.length > 1);
  const lastName = allCaps.length > 0 ? allCaps.join(' ') : parts.slice(-1).join(' ');
  const firstName =
    allCaps.length > 0
      ? parts.filter((p) => p !== p.toUpperCase()).join(' ') || parts[0]
      : parts.slice(0, -1).join(' ') || parts[0];
  return { firstName: firstName.trim(), lastName: lastName.trim() };
}

/** Parse ranking string "1", "8- 9", "10- 12" → number (first number in string) */
export function parseRank(rankStr: string): number {
  const first = rankStr.replace(/[^\d]/g, '');
  return first ? parseInt(first, 10) : 999;
}

/** Split inter-club string "Club A - Club B" into clubs array. Single club returns [club]. */
export function parseClubNames(clubStr: string): {
  clubs: string[];
  isInterClub: boolean;
} {
  const raw = (clubStr || '').trim();
  if (!raw) return { clubs: [], isInterClub: false };
  if (raw.includes(' - ')) {
    const parts = raw
      .split(' - ')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) return { clubs: [parts[0], parts[1]], isInterClub: true };
  }
  return { clubs: [raw], isInterClub: false };
}
```

- [x] **Step 2 : Écrire les tests dans `apps/backend/scripts/sync-licensees.utils.spec.ts`**

```typescript
import {
  normalizeForMatch,
  parseClubNames,
  parseFullName,
  parseRank,
} from './sync-licensees.utils';

describe('normalizeForMatch', () => {
  it('removes accents', () => {
    expect(normalizeForMatch('éàü')).toBe('eau');
  });

  it('lowercases the string', () => {
    expect(normalizeForMatch('DUPONT')).toBe('dupont');
  });

  it('trims whitespace', () => {
    expect(normalizeForMatch('  Jean  ')).toBe('jean');
  });

  it('handles combined accents, case, and spaces', () => {
    expect(normalizeForMatch('  Élodie MARTIN  ')).toBe('elodie martin');
  });
});

describe('parseFullName', () => {
  it("parses 'Jean DUPONT' into firstName=Jean, lastName=DUPONT", () => {
    expect(parseFullName('Jean DUPONT')).toEqual({
      firstName: 'Jean',
      lastName: 'DUPONT',
    });
  });

  it("parses 'Marie-Claire DUPONT MARTIN' with compound last name", () => {
    const result = parseFullName('Marie-Claire DUPONT MARTIN');
    expect(result.lastName).toBe('DUPONT MARTIN');
    expect(result.firstName).toBe('Marie-Claire');
  });

  it('returns same value for firstName and lastName when single word', () => {
    expect(parseFullName('Jean')).toEqual({ firstName: 'Jean', lastName: 'Jean' });
  });

  it('trims extra spaces', () => {
    const result = parseFullName('  Jean  DUPONT  ');
    expect(result.firstName).toBe('Jean');
    expect(result.lastName).toBe('DUPONT');
  });
});

describe('parseRank', () => {
  it("parses simple integer '1'", () => {
    expect(parseRank('1')).toBe(1);
  });

  it("parses range '8- 9' as first number 8", () => {
    expect(parseRank('8- 9')).toBe(8);
  });

  it("parses range '10- 12' as first number 10", () => {
    expect(parseRank('10- 12')).toBe(10);
  });

  it('returns 999 for empty string', () => {
    expect(parseRank('')).toBe(999);
  });

  it('returns 999 for non-numeric string', () => {
    expect(parseRank('abc')).toBe(999);
  });
});

describe('parseClubNames', () => {
  it('returns single club without isInterClub flag', () => {
    expect(parseClubNames('CVDS')).toEqual({
      clubs: ['CVDS'],
      isInterClub: false,
    });
  });

  it("parses inter-club 'Club A - Club B'", () => {
    expect(parseClubNames('Club A - Club B')).toEqual({
      clubs: ['Club A', 'Club B'],
      isInterClub: true,
    });
  });

  it('returns empty clubs for empty string', () => {
    expect(parseClubNames('')).toEqual({ clubs: [], isInterClub: false });
  });

  it('trims club names', () => {
    const result = parseClubNames('  CVDS  -  SCDB  ');
    expect(result.clubs).toEqual(['CVDS', 'SCDB']);
    expect(result.isInterClub).toBe(true);
  });
});
```

- [x] **Step 3 : Lancer les tests pour vérifier qu'ils échouent (fonctions pas encore importées)**

```bash
cd apps/backend && pnpm test scripts/sync-licensees.utils.spec.ts 2>&1 | tail -10
```

Attendu : FAIL — `Cannot find module './sync-licensees.utils'`

- [x] **Step 4 : Remplacer les fonctions dans le script original par des imports**

Lire `apps/backend/scripts/sync-licensees-from-compete.ts` autour des lignes 233-285 pour localiser exactement les 4 fonctions, puis :

1. Supprimer les 4 définitions de fonctions du script (`normalizeForMatch`, `parseFullName`, `parseRank`, `parseClubNames`)
2. Ajouter en haut du script (après les imports existants) :

```typescript
import {
  normalizeForMatch,
  parseFullName,
  parseRank,
  parseClubNames,
} from './sync-licensees.utils';
```

- [x] **Step 5 : Lancer les tests**

```bash
cd apps/backend && pnpm test scripts/sync-licensees.utils.spec.ts 2>&1 | tail -10
```

Attendu : tous les tests passent

- [x] **Step 6 : Vérifier qu'il n'y a pas de régression dans le script**

```bash
cd apps/backend && pnpm build 2>&1 | grep -i error | grep -v "^>" | head -5
```

Attendu : aucune erreur TypeScript

- [x] **Step 7 : Commit**

```bash
git add apps/backend/scripts/sync-licensees.utils.ts apps/backend/scripts/sync-licensees.utils.spec.ts apps/backend/scripts/sync-licensees-from-compete.ts
git commit -m "refactor(scripts): extract and test pure parsing functions from sync-licensees script"
```

---

## Tâche 3 : licenses.service.ts — 24% → 70%+ branches

**Files:**

- Modify: `apps/backend/src/licenses/licenses.service.spec.ts`
- Modify: `apps/backend/jest.config.js`

### Contexte

Le fichier `licenses.service.spec.ts` a déjà les mocks `mockPrisma` (avec `license` et `user`) et `mockOcr` (avec `extractLicenseInfo`). Il manque les mocks pour `licenseRenewalRequest`, `licenseRenewalDocument`, et `ocrService.extractMedicalCertificateInfo`. Les lignes 165-420 du service ne sont pas couvertes.

- [x] **Step 1 : Mesurer la couverture actuelle**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/licenses/licenses.service.ts" src/licenses/licenses.service.spec.ts 2>/dev/null | grep -E "licenses.service.ts|Branch"
```

Noter le % branches actuel.

- [x] **Step 2 : Étendre les mocks dans `licenses.service.spec.ts`**

Lire le fichier pour trouver exactement où est défini `mockPrisma`, puis le remplacer par une version étendue :

```typescript
const mockPrisma = {
  license: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  licenseRenewalRequest: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  licenseRenewalDocument: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockOcr = {
  extractLicenseInfo: jest.fn(),
  extractMedicalCertificateInfo: jest.fn(),
};
```

- [x] **Step 3 : Ajouter les tests pour `startRenewalRequest`**

Ajouter après les describes existants dans `licenses.service.spec.ts` :

```typescript
describe('startRenewalRequest', () => {
  it('returns existing draft request without creating a new one', async () => {
    const existing = { id: 'req-1', userId: 'user-1', status: 'DRAFT', documents: [] };
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(existing);

    const result = await service.startRenewalRequest('user-1');

    expect(result).toBe(existing);
    expect(mockPrisma.licenseRenewalRequest.create).not.toHaveBeenCalled();
  });

  it('creates a new draft request when none exists', async () => {
    const created = { id: 'req-2', userId: 'user-1', status: 'DRAFT', documents: [] };
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.licenseRenewalRequest.create.mockResolvedValue(created);

    const result = await service.startRenewalRequest('user-1');

    expect(result).toBe(created);
    expect(mockPrisma.licenseRenewalRequest.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', status: 'DRAFT' },
      include: { documents: true },
    });
  });
});
```

- [x] **Step 4 : Ajouter les tests pour `uploadRenewalDocument`**

```typescript
describe('uploadRenewalDocument', () => {
  it('throws NotFoundException when request does not exist', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.uploadRenewalDocument('user-1', 'req-1', 'MEDICAL_CERTIFICATE' as never, '/path'),
    ).rejects.toThrow('Demande de renouvellement non trouvée');
  });

  it('throws BadRequestException when request is not in DRAFT status', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'PENDING',
      documents: [],
    });

    await expect(
      service.uploadRenewalDocument('user-1', 'req-1', 'MEDICAL_CERTIFICATE' as never, '/path'),
    ).rejects.toThrow('Seules les demandes en brouillon');
  });

  it('throws BadRequestException when medical certificate says isApte=false', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'DRAFT',
      documents: [],
    });
    mockOcr.extractMedicalCertificateInfo.mockResolvedValue({ isApte: false });

    await expect(
      service.uploadRenewalDocument('user-1', 'req-1', 'MEDICAL_CERTIFICATE' as never, '/path'),
    ).rejects.toThrow("n'êtes pas apte");
  });

  it('throws BadRequestException when medical certificate isApte is unknown (not true/false)', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'DRAFT',
      documents: [],
    });
    mockOcr.extractMedicalCertificateInfo.mockResolvedValue({ isApte: null });

    await expect(
      service.uploadRenewalDocument('user-1', 'req-1', 'MEDICAL_CERTIFICATE' as never, '/path'),
    ).rejects.toThrow("Impossible de confirmer l'aptitude");
  });

  it('processes LICENSE_CERTIFICATE type without medical OCR', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'DRAFT',
      documents: [],
    });
    mockOcr.extractLicenseInfo.mockResolvedValue({ licenseNumber: '12345' });
    mockPrisma.licenseRenewalDocument.deleteMany.mockResolvedValue({});
    mockPrisma.licenseRenewalDocument.create.mockResolvedValue({});
    const updated = { id: 'req-1', documents: [] };
    mockPrisma.licenseRenewalRequest.findUniqueOrThrow.mockResolvedValue(updated);

    const result = await service.uploadRenewalDocument(
      'user-1',
      'req-1',
      'LICENSE_CERTIFICATE' as never,
      '/path',
    );

    expect(mockOcr.extractMedicalCertificateInfo).not.toHaveBeenCalled();
    expect(mockOcr.extractLicenseInfo).toHaveBeenCalledWith('/path');
    expect(result).toBe(updated);
  });
});
```

- [x] **Step 5 : Ajouter les tests pour `submitRenewalRequest`**

```typescript
describe('submitRenewalRequest', () => {
  it('throws NotFoundException when request does not exist', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

    await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
      'Demande de renouvellement non trouvée',
    );
  });

  it('throws BadRequestException when request is already submitted', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'PENDING',
      documents: [],
    });

    await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
      'La demande a déjà été soumise',
    );
  });

  it('throws BadRequestException when medical document is missing', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'DRAFT',
      documents: [],
    });

    await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
      'Le certificat médical est obligatoire',
    );
  });

  it('throws BadRequestException when license document is missing', async () => {
    mockPrisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'DRAFT',
      documents: [{ type: 'MEDICAL_CERTIFICATE', ocrData: { isApte: true } }],
    });

    await expect(service.submitRenewalRequest('user-1', 'req-1')).rejects.toThrow(
      'Le certificat de licence est obligatoire',
    );
  });
});
```

- [x] **Step 6 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/licenses/licenses.service.spec.ts 2>&1 | tail -10
```

Attendu : tous les tests passent. Si un test échoue à cause d'un message d'erreur légèrement différent, lire `licenses.service.ts` pour trouver le message exact et corriger le test.

- [x] **Step 7 : Mesurer la couverture améliorée**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/licenses/licenses.service.ts" src/licenses/licenses.service.spec.ts 2>/dev/null | grep "licenses.service.ts"
```

Attendu : branches > 60%

- [x] **Step 8 : Ajouter le seuil dans jest.config.js**

Lire `apps/backend/jest.config.js` pour trouver la section `coverageThreshold`, puis ajouter :

```javascript
"./src/licenses/licenses.service.ts": {
  branches: 55,
  functions: 60,
  lines: 60,
  statements: 60,
},
```

Utiliser un seuil légèrement inférieur à la couverture mesurée à l'étape 7.

- [x] **Step 9 : Vérifier que le seuil passe**

```bash
cd apps/backend && pnpm test --coverage src/licenses/licenses.service.spec.ts 2>&1 | tail -15
```

Attendu : pas d'erreur de seuil

- [x] **Step 10 : Run full test suite**

```bash
cd apps/backend && pnpm test 2>&1 | tail -5
```

Attendu : tous les tests passent

- [x] **Step 11 : Commit**

```bash
git add apps/backend/src/licenses/licenses.service.spec.ts apps/backend/jest.config.js
git commit -m "test(licenses): add branch coverage for startRenewalRequest, uploadRenewalDocument, submitRenewalRequest"
```

---

## Tâche 4 : competitions.service.ts — 43% → 65%+ branches

**Files:**

- Modify: `apps/backend/src/competitions/competitions.service.spec.ts`
- Modify: `apps/backend/jest.config.js`

### Contexte

Le fichier `competitions.service.spec.ts` a déjà tous les mocks (`mockPrismaService`, `mockSyncQueue`, `mockRedis`). Il faut utiliser `createMockPrismaService()` qui est déjà importé. Les branches à couvrir sont dans `enqueueSyncFFD`, `getSyncStatus`, `registerMember`, `getPendingRegistrationsForClub`, et `ensureMemberBelongsToOrganizerClub`.

`createMockPrismaService()` retourne un mock avec toutes les méthodes Prisma. Pour chaque méthode utilisée dans les tests, appeler `.mockResolvedValue()` dessus.

- [x] **Step 1 : Mesurer la couverture actuelle**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/competitions/competitions.service.ts" src/competitions/competitions.service.spec.ts 2>/dev/null | grep "competitions.service.ts"
```

- [x] **Step 2 : Ajouter les tests pour `enqueueSyncFFD`**

Lire le fichier `competitions.service.spec.ts` pour trouver la fin du dernier `describe`, puis ajouter :

```typescript
describe('enqueueSyncFFD', () => {
  it('throws ConflictException when a sync job is already running', async () => {
    mockSyncQueue.getJobs.mockResolvedValue([{ id: 'job-1' }]);

    await expect(service.enqueueSyncFFD()).rejects.toThrow('A sync is already in progress');
  });

  it('enqueues a new sync job and stores its id in redis when no job is running', async () => {
    mockSyncQueue.getJobs.mockResolvedValue([]);
    mockSyncQueue.add.mockResolvedValue({ id: 'job-new' });
    mockRedis.set.mockResolvedValue(undefined);

    const result = await service.enqueueSyncFFD();

    expect(result).toEqual({ jobId: 'job-new' });
    expect(mockRedis.set).toHaveBeenCalledWith('ffd-sync:latest-job-id', 'job-new');
  });
});
```

- [x] **Step 3 : Ajouter les tests pour `getSyncStatus`**

```typescript
describe('getSyncStatus', () => {
  it('returns idle status when no jobId in redis', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await service.getSyncStatus();

    expect(result).toEqual({ status: 'idle' });
  });

  it('returns idle status when job is not found in queue', async () => {
    mockRedis.get.mockResolvedValue('job-123');
    mockSyncQueue.getJob.mockResolvedValue(null);

    const result = await service.getSyncStatus();

    expect(result).toEqual({ status: 'idle' });
  });

  it('returns completed status with stats when job is completed', async () => {
    const stats = { total: 10, created: 5 };
    mockRedis.get.mockResolvedValue('job-123');
    mockSyncQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: stats,
      failedReason: undefined,
    });

    const result = await service.getSyncStatus();

    expect(result).toEqual({ status: 'completed', jobId: 'job-123', stats });
  });

  it('returns failed status with error when job failed', async () => {
    mockRedis.get.mockResolvedValue('job-123');
    mockSyncQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('failed'),
      returnvalue: undefined,
      failedReason: 'Connection timeout',
    });

    const result = await service.getSyncStatus();

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Connection timeout');
  });
});
```

- [x] **Step 4 : Ajouter les tests pour `getPendingRegistrationsForClub`**

```typescript
describe('getPendingRegistrationsForClub', () => {
  it('returns empty array when organizer role is not CLUB', async () => {
    (mockPrismaService.user.findUnique as jest.Mock).mockResolvedValue({
      role: 'LICENSEE',
      clubId: 'club-1',
      clubName: 'CVDS',
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });

  it('returns empty array when organizer has no clubId and no clubName', async () => {
    (mockPrismaService.user.findUnique as jest.Mock).mockResolvedValue({
      role: 'CLUB',
      clubId: null,
      clubName: null,
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });
});
```

- [x] **Step 5 : Ajouter les tests pour `ensureMemberBelongsToOrganizerClub` (via `registerMember`)**

```typescript
describe('registerMember — ensureMemberBelongsToOrganizerClub', () => {
  it('throws NotFoundException when organizer is not a CLUB role', async () => {
    (mockPrismaService.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'LICENSEE', clubId: 'club-1', clubName: 'CVDS' }) // organizer
      .mockResolvedValueOnce({ clubId: 'club-1', clubName: 'CVDS' }); // member

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      "Réservé à l'organisateur du club",
    );
  });

  it('throws NotFoundException when member does not exist', async () => {
    (mockPrismaService.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'CLUB', clubId: 'club-1', clubName: 'CVDS' }) // organizer
      .mockResolvedValueOnce(null); // member not found

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      'Membre non trouvé',
    );
  });

  it('throws NotFoundException when member belongs to a different club', async () => {
    (mockPrismaService.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'CLUB', clubId: 'club-1', clubName: 'CVDS' }) // organizer
      .mockResolvedValueOnce({ clubId: 'club-2', clubName: 'Other Club' }); // member in different club

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      'les membres de votre club',
    );
  });

  it('throws NotFoundException when event does not exist after club check passes', async () => {
    (mockPrismaService.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'CLUB', clubId: 'club-1', clubName: 'CVDS' }) // organizer
      .mockResolvedValueOnce({ clubId: 'club-1', clubName: 'CVDS' }); // member in same club
    (mockPrismaService.event.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      'Événement non trouvé',
    );
  });
});
```

- [x] **Step 6 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/competitions/competitions.service.spec.ts 2>&1 | tail -10
```

Attendu : tous les tests passent. Si un test échoue parce que `mockPrismaService.user.findUnique` ou `mockPrismaService.event.findUnique` ne sont pas des `jest.Mock`, lire `apps/backend/src/competitions/__mocks__/types.ts` pour comprendre la structure de `createMockPrismaService()` et ajuster le cast.

- [x] **Step 7 : Mesurer la couverture**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/competitions/competitions.service.ts" src/competitions/competitions.service.spec.ts 2>/dev/null | grep "competitions.service.ts"
```

Attendu : branches > 60%

- [x] **Step 8 : Ajouter le seuil dans jest.config.js**

```javascript
"./src/competitions/competitions.service.ts": {
  branches: 55,
  functions: 60,
  lines: 60,
  statements: 60,
},
```

- [x] **Step 9 : Run full test suite**

```bash
cd apps/backend && pnpm test 2>&1 | tail -5
```

Attendu : tous les tests passent

- [x] **Step 10 : Commit**

```bash
git add apps/backend/src/competitions/competitions.service.spec.ts apps/backend/jest.config.js
git commit -m "test(competitions): add branch coverage for enqueueSyncFFD, getSyncStatus, registerMember, getPendingRegistrationsForClub"
```

---

## Self-review

**Spec coverage :**

- ✅ Teardown 8 Timeout handles → Tâche 1
- ✅ Script utils extraction + tests → Tâche 2
- ✅ licenses.service branches → Tâche 3
- ✅ competitions.service branches → Tâche 4

**Placeholders :** aucun. Les messages d'erreur dans les tests correspondent aux strings exactes lues dans le service (ou sont des substrings suffisamment uniques). Si un message exact diffère, le plan indique de lire le fichier source.

**Cohérence des types :** `mockPrisma` dans la tâche 3 est défini en une seule fois au step 2 et utilisé dans tous les steps suivants. `mockPrismaService` dans la tâche 4 vient du setup existant — les casts `as jest.Mock` sont nécessaires car `createMockPrismaService()` retourne un type générique.
