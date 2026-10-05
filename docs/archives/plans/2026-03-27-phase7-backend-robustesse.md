# Phase 7 — Backend Robustesse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ajouter le préfixe `/api/v1` sur toutes les routes backend, isoler les pannes des services externes (Google Vision, TTS, WDSF) avec des circuit breakers `opossum`, et ajouter deux index Prisma manquants sur `Registration` et `Result`.

**Architecture:** Trois axes indépendants — (1) `setGlobalPrefix` dans `main.ts` sans toucher les contrôleurs, (2) `CircuitBreakerService` injectable wrappant les appels dans `OcrService`/`TtsService`/`WdsfService`, (3) deux index composites dans `schema.prisma` + migration.

**Tech Stack:** NestJS 11, opossum (circuit breaker), Prisma 7, TypeScript 5.6, Jest 29

---

## Fichiers impactés

### Créer

- `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts` — service injectable NestJS gérant des breakers opossum par clé
- `apps/backend/src/common/circuit-breaker/circuit-breaker.service.spec.ts` — tests unitaires des états open/halfOpen/close

### Modifier

- `apps/backend/src/main.ts` — ajouter `app.setGlobalPrefix('api/v1')`
- `apps/backend/src/app.module.ts` — enregistrer `CircuitBreakerService` comme provider global
- `apps/backend/src/utils/ocr.service.ts` — injecter `CircuitBreakerService`, wrapper les deux appels `withTimeout`
- `apps/backend/src/tts/tts.service.ts` — injecter `CircuitBreakerService`, wrapper l'appel `withTimeout`
- `apps/backend/src/wdsf/wdsf.service.ts` — injecter `CircuitBreakerService`, wrapper les appels HTTP
- `apps/backend/prisma/schema.prisma` — ajouter deux index composites
- `apps/backend/test/test-app.factory.ts` — ajouter `setGlobalPrefix` dans le helper de test
- `apps/client/.env.example` — ajouter `/api/v1` dans `EXPO_PUBLIC_API_URL`

---

## Task 1 — Installer opossum

**Files:**

- Modify: `apps/backend/package.json`

- [x] **Step 1 : Installer la librairie**

```bash
cd apps/backend && pnpm add opossum && pnpm add -D @types/opossum
```

Expected output: `Done in X.Xs`

- [x] **Step 2 : Vérifier le typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected: aucune erreur nouvelle.

---

## Task 2 — CircuitBreakerService

**Files:**

- Create: `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts`
- Create: `apps/backend/src/common/circuit-breaker/circuit-breaker.service.spec.ts`

- [x] **Step 1 : Écrire le test unitaire**

```typescript
// apps/backend/src/common/circuit-breaker/circuit-breaker.service.spec.ts
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  it('executes the function and returns its result when closed', async () => {
    const result = await service.fire('google-vision', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('propagates errors from the wrapped function', async () => {
    await expect(
      service.fire('google-tts', async () => {
        throw new Error('TTS down');
      }),
    ).rejects.toThrow('TTS down');
  });

  it('opens the breaker after errorThresholdPercentage is exceeded', async () => {
    // Force 10 failures to trip the breaker (volume threshold)
    for (let i = 0; i < 10; i++) {
      await service
        .fire('wdsf', async () => {
          throw new Error('WDSF unavailable');
        })
        .catch(() => {});
    }
    // Next call should be rejected immediately with 503
    await expect(service.fire('wdsf', async () => 'should not run')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailableException (not the original error) when open', async () => {
    for (let i = 0; i < 10; i++) {
      await service
        .fire('google-vision', async () => {
          throw new Error('Vision down');
        })
        .catch(() => {});
    }
    await expect(service.fire('google-vision', async () => 'x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
```

- [x] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && pnpm test src/common/circuit-breaker/circuit-breaker.service.spec.ts
```

Expected: FAIL — `CircuitBreakerService` is not defined.

- [x] **Step 3 : Implémenter `CircuitBreakerService`**

```typescript
// apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import CircuitBreaker from 'opossum';

type BreakerKey = 'google-vision' | 'google-tts' | 'wdsf';

interface BreakerConfig {
  errorThresholdPercentage: number;
  timeout: number;
  resetTimeout: number;
  volumeThreshold: number;
}

const BREAKER_CONFIGS: Record<BreakerKey, BreakerConfig> = {
  'google-vision': {
    errorThresholdPercentage: 50,
    timeout: 15_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  'google-tts': {
    errorThresholdPercentage: 50,
    timeout: 10_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
  wdsf: {
    errorThresholdPercentage: 50,
    timeout: 30_000,
    resetTimeout: 60_000,
    volumeThreshold: 5,
  },
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<BreakerKey, CircuitBreaker<unknown[], unknown>>();

  private getBreaker(key: BreakerKey): CircuitBreaker<unknown[], unknown> {
    if (!this.breakers.has(key)) {
      const config = BREAKER_CONFIGS[key];
      const breaker = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
        errorThresholdPercentage: config.errorThresholdPercentage,
        timeout: config.timeout,
        resetTimeout: config.resetTimeout,
        volumeThreshold: config.volumeThreshold,
      });

      breaker.on('open', () =>
        this.logger.warn(`Circuit breaker OPEN for ${key}`, CircuitBreakerService.name),
      );
      breaker.on('halfOpen', () =>
        this.logger.log(`Circuit breaker HALF-OPEN for ${key}`, CircuitBreakerService.name),
      );
      breaker.on('close', () =>
        this.logger.log(`Circuit breaker CLOSED for ${key}`, CircuitBreakerService.name),
      );

      this.breakers.set(key, breaker);
    }
    return this.breakers.get(key)!;
  }

  async fire<T>(key: BreakerKey, fn: () => Promise<T>): Promise<T> {
    const breaker = this.getBreaker(key);
    try {
      return (await breaker.fire(fn)) as T;
    } catch (err) {
      if (breaker.opened) {
        throw new ServiceUnavailableException(
          `Service ${key} is temporarily unavailable. Please try again later.`,
        );
      }
      throw err;
    }
  }
}
```

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/common/circuit-breaker/circuit-breaker.service.spec.ts
```

Expected: PASS — 4 tests passing.

- [x] **Step 5 : Commit**

```bash
cd apps/backend && git add src/common/circuit-breaker/
git commit -m "feat(circuit-breaker): add CircuitBreakerService with opossum (google-vision, google-tts, wdsf)"
```

---

## Task 3 — Enregistrer CircuitBreakerService dans AppModule

**Files:**

- Modify: `apps/backend/src/app.module.ts`

- [x] **Step 1 : Ajouter le provider dans AppModule**

Dans `apps/backend/src/app.module.ts`, ajouter l'import et le provider :

```typescript
// Ajouter l'import en haut du fichier
import { CircuitBreakerService } from './common/circuit-breaker/circuit-breaker.service';
```

Dans le décorateur `@Module({...})`, ajouter dans `providers` :

```typescript
providers: [
  // ... providers existants (APP_FILTER, APP_GUARD, etc.)
  CircuitBreakerService,
],
exports: [CircuitBreakerService],
```

> Note : `CircuitBreakerService` doit être dans `providers` ET `exports` d'AppModule pour être injectable dans les feature modules via `imports: [AppModule]`. Alternativement, le mettre dans un `CommonModule` partagé. L'approche la plus simple ici est de l'ajouter directement en tant que provider global avec `@Global()`.

Modifier `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts` pour ajouter le module :

```typescript
// apps/backend/src/common/circuit-breaker/circuit-breaker.module.ts
import { Global, Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

@Global()
@Module({
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {}
```

Dans `apps/backend/src/app.module.ts`, importer `CircuitBreakerModule` :

```typescript
import { CircuitBreakerModule } from './common/circuit-breaker/circuit-breaker.module';

// Dans imports: [..., CircuitBreakerModule]
```

- [x] **Step 2 : Vérifier la compilation**

```bash
cd apps/backend && pnpm build
```

Expected: BUILD SUCCESSFUL.

- [x] **Step 3 : Commit**

```bash
git add src/common/circuit-breaker/circuit-breaker.module.ts src/app.module.ts
git commit -m "feat(circuit-breaker): register CircuitBreakerModule as global in AppModule"
```

---

## Task 4 — Intégrer dans OcrService

**Files:**

- Modify: `apps/backend/src/utils/ocr.service.ts`
- Modify: `apps/backend/src/utils/ocr.service.spec.ts`

- [x] **Step 1 : Lire le test existant pour connaître la structure**

```bash
head -60 apps/backend/src/utils/ocr.service.spec.ts
```

- [x] **Step 2 : Ajouter le test du circuit breaker dans le spec existant**

Dans `apps/backend/src/utils/ocr.service.spec.ts`, ajouter dans le `describe` principal :

```typescript
it('propagates ServiceUnavailableException from circuit breaker', async () => {
  const { ServiceUnavailableException } = await import('@nestjs/common');
  const circuitBreakerService = {
    fire: jest.fn().mockRejectedValue(new ServiceUnavailableException('google-vision unavailable')),
  };
  // Recréer le service avec le mock du circuit breaker
  const { OcrService } = await import('./ocr.service');
  const svc = new OcrService(
    { get: jest.fn().mockReturnValue('fake-creds') } as never,
    circuitBreakerService as never,
  );
  // Force client to be truthy to bypass mock mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).client = {};
  await expect(svc.extractLicenseInfo('/tmp/test.jpg')).rejects.toThrow(
    ServiceUnavailableException,
  );
});
```

- [x] **Step 3 : Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && pnpm test src/utils/ocr.service.spec.ts --testNamePattern="circuit breaker"
```

Expected: FAIL.

- [x] **Step 4 : Modifier OcrService**

```typescript
// apps/backend/src/utils/ocr.service.ts
// Ajouter l'import
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";

// Modifier le constructeur
constructor(
  private configService: ConfigService,
  private circuitBreakerService: CircuitBreakerService,
) {}

// Dans extractLicenseInfo, remplacer :
//   const [result] = await withTimeout(this.client.textDetection(imagePath), 15_000, "Vision.textDetection (license)");
// Par :
const [result] = await this.circuitBreakerService.fire(
  "google-vision",
  () => withTimeout(this.client.textDetection(imagePath), 15_000, "Vision.textDetection (license)"),
);

// Dans extractMedicalCertificateInfo, même remplacement :
const [result] = await this.circuitBreakerService.fire(
  "google-vision",
  () => withTimeout(this.client.textDetection(imagePath), 15_000, "Vision.textDetection (medical)"),
);
```

- [x] **Step 5 : Lancer tous les tests OCR**

```bash
cd apps/backend && pnpm test src/utils/ocr.service.spec.ts
```

Expected: PASS.

- [x] **Step 6 : Commit**

```bash
git add src/utils/ocr.service.ts src/utils/ocr.service.spec.ts
git commit -m "feat(ocr): wrap Google Vision calls with CircuitBreakerService"
```

---

## Task 5 — Intégrer dans TtsService

**Files:**

- Modify: `apps/backend/src/tts/tts.service.ts`
- Modify: `apps/backend/src/tts/tts.service.spec.ts`

- [x] **Step 1 : Ajouter le test circuit breaker dans tts.service.spec.ts**

Dans `apps/backend/src/tts/tts.service.spec.ts`, ajouter :

```typescript
it('propagates ServiceUnavailableException when TTS circuit breaker is open', async () => {
  const { ServiceUnavailableException } = await import('@nestjs/common');
  const circuitBreakerService = {
    fire: jest.fn().mockRejectedValue(new ServiceUnavailableException('google-tts unavailable')),
  };
  const svc = new TtsService(
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { get: jest.fn().mockResolvedValue(null) } as never,
    circuitBreakerService as never,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).client = { synthesizeSpeech: jest.fn() };
  await expect(svc.getTtsAudio('test')).rejects.toThrow(ServiceUnavailableException);
});
```

- [x] **Step 2 : Lancer le test pour confirmer qu'il échoue**

```bash
cd apps/backend && pnpm test src/tts/tts.service.spec.ts --testNamePattern="circuit breaker"
```

Expected: FAIL.

- [x] **Step 3 : Modifier TtsService**

```typescript
// apps/backend/src/tts/tts.service.ts
// Ajouter l'import
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";

// Modifier le constructeur
constructor(
  private configService: ConfigService,
  private redisService: RedisService,
  private circuitBreakerService: CircuitBreakerService,
) { ... }

// Dans getTtsAudio, remplacer :
//   const [response] = await withTimeout(this.client.synthesizeSpeech(request), 10_000, "Google TTS synthesizeSpeech");
// Par :
const [response] = await this.circuitBreakerService.fire(
  "google-tts",
  () => withTimeout(this.client.synthesizeSpeech(request), 10_000, "Google TTS synthesizeSpeech"),
);
```

- [x] **Step 4 : Lancer tous les tests TTS**

```bash
cd apps/backend && pnpm test src/tts/tts.service.spec.ts
```

Expected: PASS.

- [x] **Step 5 : Commit**

```bash
git add src/tts/tts.service.ts src/tts/tts.service.spec.ts
git commit -m "feat(tts): wrap Google TTS synthesizeSpeech with CircuitBreakerService"
```

---

## Task 6 — Intégrer dans WdsfService

**Files:**

- Modify: `apps/backend/src/wdsf/wdsf.service.ts`
- Modify: `apps/backend/src/wdsf/wdsf.service.spec.ts`

- [x] **Step 1 : Identifier les appels HTTP dans WdsfService**

```bash
grep -n "firstValueFrom\|httpService" apps/backend/src/wdsf/wdsf.service.ts | head -20
```

Note les lignes avec `firstValueFrom(this.httpService.get(...))` — ce sont ces appels à wrapper.

- [x] **Step 2 : Ajouter le test circuit breaker**

Dans `apps/backend/src/wdsf/wdsf.service.spec.ts`, ajouter :

```typescript
it('throws ServiceUnavailableException when WDSF circuit breaker is open', async () => {
  const { ServiceUnavailableException } = await import('@nestjs/common');
  const circuitBreakerService = {
    fire: jest.fn().mockRejectedValue(new ServiceUnavailableException('wdsf unavailable')),
  };
  const svc = new WdsfService(
    {
      get: jest.fn((key: string) =>
        key === 'WDSF_USERNAME' ? 'user' : key === 'WDSF_PASSWORD' ? 'pass' : undefined,
      ),
    } as never,
    { get: jest.fn() } as never,
    circuitBreakerService as never,
  );
  await expect(svc.searchAthletes('Dupont')).rejects.toThrow(ServiceUnavailableException);
});
```

- [x] **Step 3 : Lancer le test pour confirmer qu'il échoue**

```bash
cd apps/backend && pnpm test src/wdsf/wdsf.service.spec.ts --testNamePattern="circuit breaker"
```

Expected: FAIL.

- [x] **Step 4 : Modifier WdsfService**

```typescript
// apps/backend/src/wdsf/wdsf.service.ts
// Ajouter l'import
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";

// Modifier le constructeur
constructor(
  private configService: ConfigService,
  private httpService: HttpService,
  private circuitBreakerService: CircuitBreakerService,
) {}
```

Pour chaque appel `firstValueFrom(this.httpService.get(...))` ou `firstValueFrom(this.httpService.post(...))` dans le service, wrapper avec le circuit breaker :

```typescript
// Avant :
const response = await firstValueFrom(this.httpService.get(url, { headers }));

// Après :
const response = await this.circuitBreakerService.fire('wdsf', () =>
  firstValueFrom(this.httpService.get(url, { headers })),
);
```

- [x] **Step 5 : Lancer tous les tests WDSF**

```bash
cd apps/backend && pnpm test src/wdsf/wdsf.service.spec.ts
```

Expected: PASS.

- [x] **Step 6 : Lancer la suite complète**

```bash
cd apps/backend && pnpm test
```

Expected: tous les tests passent.

- [x] **Step 7 : Commit**

```bash
git add src/wdsf/wdsf.service.ts src/wdsf/wdsf.service.spec.ts
git commit -m "feat(wdsf): wrap WDSF HTTP calls with CircuitBreakerService"
```

---

## Task 7 — API Versioning : setGlobalPrefix

**Files:**

- Modify: `apps/backend/src/main.ts`
- Modify: `apps/backend/test/test-app.factory.ts`
- Modify: `apps/client/.env.example`

- [x] **Step 1 : Ajouter le préfixe dans main.ts**

Dans `apps/backend/src/main.ts`, après `app.useGlobalPipes(...)` et avant le bloc Swagger, ajouter :

```typescript
// API versioning — toutes les routes sont préfixées /api/v1
app.setGlobalPrefix('api/v1');
```

- [x] **Step 2 : Mettre à jour le helper de test**

Dans `apps/backend/test/test-app.factory.ts`, ajouter `setGlobalPrefix` :

```typescript
export async function configureTestApp(app: INestApplication): Promise<void> {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
}
```

- [x] **Step 3 : Lancer les tests E2E pour détecter les URLs cassées**

```bash
cd apps/backend && pnpm test:e2e 2>&1 | grep -E "FAIL|PASS|404" | head -30
```

Expected: certains tests échoueront avec 404 — ce sont les URLs à mettre à jour dans les specs E2E.

- [x] **Step 4 : Mettre à jour toutes les URLs dans les tests E2E**

Les tests E2E utilisent des URLs comme `/auth/login` — les remplacer par `/api/v1/auth/login`.

```bash
# Trouver toutes les occurrences à mettre à jour
grep -rn '\.get("\/' apps/backend/test/ --include="*.ts" | grep -v "api/v1" | head -20
grep -rn '\.post("\/' apps/backend/test/ --include="*.ts" | grep -v "api/v1" | head -20
grep -rn '\.patch("\/' apps/backend/test/ --include="*.ts" | grep -v "api/v1" | head -20
grep -rn '\.delete("\/' apps/backend/test/ --include="*.ts" | grep -v "api/v1" | head -20
```

Pour chaque fichier listé, remplacer `/competitions` par `/api/v1/competitions`, `/auth` par `/api/v1/auth`, etc. Le pattern est simple : toute URL qui commence par `/` mais pas `/api/v1` doit être préfixée.

- [x] **Step 5 : Lancer les tests E2E à nouveau**

```bash
cd apps/backend && pnpm test:e2e
```

Expected: PASS — tous les tests passent avec les nouvelles URLs.

- [x] **Step 6 : Mettre à jour .env.example du client**

Dans `apps/client/.env.example`, trouver la ligne `EXPO_PUBLIC_API_URL` et ajouter `/api/v1` :

```
EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1
```

Faire de même dans `apps/client/.env.test` si présent.

- [x] **Step 7 : Commit**

```bash
git add apps/backend/src/main.ts apps/backend/test/ apps/client/.env.example
git commit -m "feat(api): add /api/v1 global prefix to all backend routes"
```

---

## Task 8 — Index Prisma manquants

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`

- [x] **Step 1 : Vérifier les index existants sur Registration et Result**

```bash
grep -A5 "model Registration" apps/backend/prisma/schema.prisma | grep "@@index"
grep -A5 "model Result" apps/backend/prisma/schema.prisma | grep "@@index"
```

Confirmation que `(eventId, status, userId)` et `(userId, createdAt)` n'existent pas encore.

- [x] **Step 2 : Ajouter les index dans schema.prisma**

Dans le model `Registration`, dans le bloc `@@index`, ajouter après `@@index([eventId, status])` :

```prisma
@@index([eventId, status, userId]) // inscriptions actives d'un user à une épreuve
```

Dans le model `Result`, ajouter après `@@index([createdAt])` :

```prisma
@@index([userId, createdAt]) // résultats d'un user triés par date
```

- [x] **Step 3 : Générer la migration**

```bash
cd apps/backend && pnpm prisma migrate dev --name add_registration_result_composite_indexes
```

Expected: migration créée dans `prisma/migrations/`.

- [x] **Step 4 : Vérifier la migration**

```bash
cat apps/backend/prisma/migrations/*/migration.sql | tail -20
```

Expected: deux instructions `CREATE INDEX` correspondant aux deux index ajoutés.

- [x] **Step 5 : Lancer les tests d'intégration**

```bash
cd apps/backend && pnpm test:integration
```

Expected: PASS — les tests d'intégration utilisent une vraie base PostgreSQL de test.

- [x] **Step 6 : Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "perf(db): add composite indexes on Registration(eventId,status,userId) and Result(userId,createdAt)"
```

---

## Task 9 — Vérification finale

- [x] **Step 1 : Lancer toute la suite de tests**

```bash
cd apps/backend && pnpm test && pnpm test:e2e && pnpm test:integration
```

Expected: PASS.

- [x] **Step 2 : Vérifier le build**

```bash
cd apps/backend && pnpm build
```

Expected: BUILD SUCCESSFUL.

- [x] **Step 3 : Commit final**

```bash
git commit --allow-empty -m "chore(phase7): all tests green — backend robustesse complete"
```
