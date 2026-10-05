# Phase 2 — Production-Ready

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rendre le projet production-ready : observabilité obligatoire en prod, visibilité sur les requêtes Prisma lentes, et documentation des décisions d'architecture clés.

**Architecture:** Deux axes techniques indépendants + documentation : (1) fail-fast au démarrage si New Relic absent en prod, (2) slow query logging Prisma via `$extends` query extension (Prisma 5+), (3) 2 ADRs pour documenter les patterns introduits en Phase 1.

**Tech Stack:** NestJS 11, Prisma 7 + driver adapter PrismaPg, PostgreSQL 15, TypeScript 5.6

---

## Axe 1 — Observabilité obligatoire en production

### Task 1 : New Relic requis au démarrage en `NODE_ENV=production`

**Files:**

- Modify: `apps/backend/src/main.ts`
- Create: `apps/backend/src/utils/require-production-env.ts`
- Create: `apps/backend/src/utils/require-production-env.spec.ts`

**Contexte :** Actuellement, `main.ts` loggue un `warn` si `NEW_RELIC_LICENSE_KEY` est absent, mais le serveur démarre quand même. En production, l'absence de monitoring est une erreur opérationnelle.

**Approche :** Extraire la logique de vérification dans une fonction pure testable (`requireProductionEnv`), puis l'appeler dans `bootstrap`. Cela évite d'avoir à bootstrapper NestJS entier dans les tests.

- [x] **Step 1 : Créer `require-production-env.ts`**

```typescript
// apps/backend/src/utils/require-production-env.ts

/**
 * Vérifie qu'une variable d'environnement requise est définie en production.
 * Lance process.exit(1) si la variable est absente en NODE_ENV=production.
 * Retourne un warning sinon.
 */
export function requireProductionEnv(
  key: string,
  value: string | undefined,
  nodeEnv: string | undefined,
  callbacks: {
    onError: (msg: string) => void;
    onWarn: (msg: string) => void;
    exit: (code: number) => never;
  },
): void {
  if (!value) {
    if (nodeEnv === 'production') {
      callbacks.onError(`${key} is required in production. Shutting down.`);
      callbacks.exit(1);
    }
    callbacks.onWarn(`${key} not configured. Related feature disabled.`);
  }
}
```

- [x] **Step 2 : Lancer le test (failing) pour la fonction**

Vérifier que le fichier de test n'existe pas encore :

```bash
ls apps/backend/src/utils/require-production-env.spec.ts 2>/dev/null || echo "NOT FOUND"
```

- [x] **Step 3 : Créer le test**

```typescript
// apps/backend/src/utils/require-production-env.spec.ts
import { requireProductionEnv } from './require-production-env';

describe('requireProductionEnv', () => {
  const makeCallbacks = () => ({
    onError: jest.fn(),
    onWarn: jest.fn(),
    exit: jest.fn() as unknown as (code: number) => never,
  });

  it('calls exit(1) when value is missing in production', () => {
    const cb = makeCallbacks();
    requireProductionEnv('MY_KEY', undefined, 'production', cb);
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining('MY_KEY'));
    expect(cb.exit).toHaveBeenCalledWith(1);
    expect(cb.onWarn).not.toHaveBeenCalled();
  });

  it('calls onWarn when value is missing outside production', () => {
    const cb = makeCallbacks();
    requireProductionEnv('MY_KEY', undefined, 'development', cb);
    expect(cb.onWarn).toHaveBeenCalledWith(expect.stringContaining('MY_KEY'));
    expect(cb.exit).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('does nothing when value is present', () => {
    const cb = makeCallbacks();
    requireProductionEnv('MY_KEY', 'some-value', 'production', cb);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onWarn).not.toHaveBeenCalled();
    expect(cb.exit).not.toHaveBeenCalled();
  });

  it('calls onWarn when value is missing and nodeEnv is undefined', () => {
    const cb = makeCallbacks();
    requireProductionEnv('MY_KEY', undefined, undefined, cb);
    expect(cb.onWarn).toHaveBeenCalled();
    expect(cb.exit).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 4 : Lancer le test — doit échouer (fichier implémentation pas encore créé)**

```bash
cd apps/backend && pnpm test src/utils/require-production-env.spec.ts
```

Expected : FAIL (module not found ou erreur de type).

- [x] **Step 5 : Créer le fichier d'implémentation**

Créer `apps/backend/src/utils/require-production-env.ts` avec le code du Step 1.

- [x] **Step 6 : Lancer le test — doit passer**

```bash
cd apps/backend && pnpm test src/utils/require-production-env.spec.ts
```

Expected : 4/4 PASS.

- [x] **Step 7 : Intégrer dans `main.ts`**

Dans `apps/backend/src/main.ts`, importer et utiliser la fonction. Remplacer le bloc lines 38-43 :

```typescript
// AVANT :
if (!configService.get<string>('NEW_RELIC_LICENSE_KEY')) {
  logger.warn('NEW_RELIC_LICENSE_KEY not configured. Error tracking disabled.', 'Bootstrap');
}

// APRÈS :
import { requireProductionEnv } from './utils/require-production-env';

requireProductionEnv(
  'NEW_RELIC_LICENSE_KEY',
  configService.get<string>('NEW_RELIC_LICENSE_KEY'),
  configService.get<string>('NODE_ENV'),
  {
    onError: (msg) => logger.error(msg, 'Bootstrap'),
    onWarn: (msg) => logger.warn(msg, 'Bootstrap'),
    exit: process.exit,
  },
);
```

- [x] **Step 8 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 9 : Commit**

```bash
git add apps/backend/src/utils/require-production-env.ts \
        apps/backend/src/utils/require-production-env.spec.ts \
        apps/backend/src/main.ts
git commit -m "fix(backend): fail-fast at startup if NEW_RELIC_LICENSE_KEY missing in production"
```

---

## Axe 2 — Prisma : visibilité sur les requêtes lentes

### Task 2 : Slow query logging dans `PrismaService` via `$extends`

**Files:**

- Modify: `apps/backend/src/prisma/prisma.service.ts`
- Create: `apps/backend/src/prisma/prisma.service.spec.ts`

**Contexte :** Le `PrismaService` utilise le driver adapter `PrismaPg`. Avec les driver adapters Prisma 7 :

- `$on('query')` ne déclenche **pas** d'events (le moteur interne est bypassé)
- `$use()` a été **supprimé en Prisma 5** — n'existe plus dans Prisma 7
- La solution correcte est `$extends` avec un query middleware (API Prisma 5+)

`$extends` retourne un **nouveau client typé** plutôt que de muter en place. Pour NestJS (où le DI injecte l'instance existante), utiliser `Object.assign(this, this.$extends({...}))` pour muter l'instance en place.

Le logger ne peut pas être `this.logger` dans le callback `$extends` (le `this` est le client étendu). Utiliser un logger au niveau du module (hors classe).

**Code actuel** (`prisma.service.ts`) :

```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

- [x] **Step 1 : Écrire les tests (failing)**

Créer `apps/backend/src/prisma/prisma.service.spec.ts` :

```typescript
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });

  it('should instantiate without errors', () => {
    expect(() => new PrismaService()).not.toThrow();
  });

  describe('onModuleInit', () => {
    afterEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('calls $extends in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const service = new PrismaService();

      // Éviter la vraie connexion DB
      jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      // Espionner $extends
      const extendsSpy = jest.spyOn(service, '$extends').mockReturnValue(service as never);

      await service.onModuleInit();

      expect(extendsSpy).toHaveBeenCalled();
      extendsSpy.mockRestore();
    });

    it('does NOT call $extends outside development mode', async () => {
      process.env.NODE_ENV = 'test';
      const service = new PrismaService();

      jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      const extendsSpy = jest.spyOn(service, '$extends').mockReturnValue(service as never);

      await service.onModuleInit();

      expect(extendsSpy).not.toHaveBeenCalled();
      extendsSpy.mockRestore();
    });
  });
});
```

- [x] **Step 2 : Lancer les tests pour confirmer l'échec**

```bash
cd apps/backend && pnpm test src/prisma/prisma.service.spec.ts
```

Expected : FAIL (le fichier d'implémentation n'a pas encore `$extends`).

- [x] **Step 3 : Modifier `PrismaService` pour ajouter le slow query logging**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Seuil en ms au-dessus duquel une requête Prisma est considérée lente
const SLOW_QUERY_THRESHOLD_MS = 200;

// Logger au niveau du module — nécessaire car `this` dans les callbacks $extends
// est le client étendu, pas le service NestJS
const prismaLogger = new Logger('PrismaService');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();

    // Slow query logging via $extends (Prisma 5+ — remplace $use supprimé)
    // $on('query') non supporté avec driver adapters
    // Actif uniquement en développement — en production, Pino + New Relic suffisent
    if (process.env.NODE_ENV === 'development') {
      Object.assign(
        this,
        this.$extends({
          query: {
            $allModels: {
              async $allOperations({ operation, model, args, query }) {
                const before = Date.now();
                const result = await query(args);
                const duration = Date.now() - before;
                if (duration > SLOW_QUERY_THRESHOLD_MS) {
                  prismaLogger.warn(`[SlowQuery] ${duration}ms — ${model ?? 'raw'}.${operation}`);
                }
                return result;
              },
            },
          },
        }),
      );
    }
  }
}
```

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/prisma/prisma.service.spec.ts
```

Expected : 3/3 PASS.

- [x] **Step 5 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 6 : Commit**

```bash
git add apps/backend/src/prisma/prisma.service.ts \
        apps/backend/src/prisma/prisma.service.spec.ts
git commit -m "feat(prisma): add slow query logging in development via Prisma \$extends (threshold 200ms)"
```

---

## Axe 3 — Documentation des décisions d'architecture

### Task 3 : Ajouter 2 ADRs dans `docs/architecture/README.md`

**Files:**

- Modify: `docs/architecture/README.md`

**Contexte :** Les ADRs 001-005 documentent les choix fondamentaux. Phase 1 a introduit deux patterns importants : les timeouts sur services externes (`withTimeout` utility) et le cache hybride Redis+FS pour le TTS. Les documenter comme ADR-006 et ADR-007 pour tracer la décision et son contexte.

**Format ADR existant à reproduire exactement** (voir README.md section "Décisions d'Architecture") :

```markdown
### ADR-00X: [Titre]

**Contexte:**
[Problème à résoudre]

**Décision:**
[Ce qui a été fait]

**Conséquences:**

- ✅ Avantage 1
- ⚠️ Contrainte ou inconvénient
```

- [x] **Step 1 : Lire `docs/architecture/README.md`**

Lire le fichier complet pour identifier l'emplacement exact après ADR-005 et la numérotation correcte.

- [x] **Step 2 : Ajouter ADR-006 après ADR-005**

```markdown
### ADR-006: Timeouts systématiques sur les appels à des services externes

**Contexte:**
Les services externes (Google Cloud TTS, Google Cloud Vision, yt-dlp/YouTube) peuvent ne pas répondre en cas de panne réseau ou de surcharge, laissant les requêtes en attente indéfiniment. Sans timeout, une seule requête bloquée peut épuiser le pool de connexions NestJS.

**Décision:**
Introduire un utilitaire `withTimeout<T>` (`apps/backend/src/utils/timeout.utils.ts`) qui enveloppe toute promesse externe dans un `Promise.race` avec un `setTimeout`. Le timer est toujours annulé via `clearTimeout` dans `.finally()` pour éviter les fuites de handles Node.js. Valeurs calibrées par service : 10s pour TTS, 15s pour OCR Vision, 2min pour yt-dlp.

**Conséquences:**

- ✅ Aucune requête externe ne peut bloquer le serveur indéfiniment
- ✅ Utilitaire réutilisable et testé indépendamment (`timeout.utils.spec.ts`)
- ✅ Messages d'erreur explicites avec le label du service et la durée
- ⚠️ Les opérations interrompues par timeout ne sont pas annulables côté service externe (la requête HTTP continue côté Google/YouTube jusqu'à son terme naturel)
```

- [x] **Step 3 : Ajouter ADR-007 après ADR-006**

```markdown
### ADR-007: Cache hybride Redis + système de fichiers pour le Text-to-Speech

**Contexte:**
La génération de fichiers audio TTS via Google Cloud est coûteuse (latence 1-3s, facturation à l'usage). Les annonces de compétition sont répétitives (mêmes séries, mêmes danses). Le cache doit survivre aux redémarrages et être partagé entre instances.

**Décision:**
Implémenter un cache à deux niveaux dans `TtsService` : (1) cache système de fichiers local (`uploads/tts_cache/`) identifié par hash MD5 du texte+voix+version, accès en O(1) sans réseau ; (2) cache Redis avec TTL 30 jours pour partager les fichiers entre instances. La clé de hash intègre un suffixe de version (`v5-studio`) pour invalider automatiquement le cache si la voix ou le prompt change.

**Conséquences:**

- ✅ Latence quasi-nulle pour les annonces déjà générées (lecture FS locale)
- ✅ Cohérence entre instances et survie aux redémarrages via Redis
- ✅ Invalidation automatique par versioning de hash
- ⚠️ Les fichiers audio s'accumulent sur le disque — nécessite une purge périodique des fichiers dont la clé Redis a expiré
- ⚠️ Si Redis est indisponible, le cache FS reste fonctionnel mais les nouvelles entrées ne sont pas propagées aux autres instances
```

- [x] **Step 4 : Mettre à jour la section "Évolutions Futures"**

Dans la section "Évolutions Futures > Court/Moyen Terme", marquer comme réalisés :

- `[ ] Implémenter le monitoring et l'observabilité` → `[x] Monitoring New Relic requis en production (ADR-006, Phase 2)`
- `[ ] Optimiser les performances (cache, pagination)` → `[x] Cache hybride TTS (ADR-007, Phase 1) + slow query logging Prisma (Phase 2)`

- [x] **Step 5 : Commit**

```bash
git add docs/architecture/README.md
git commit -m "docs(adr): add ADR-006 external service timeouts and ADR-007 TTS hybrid cache"
```

---

## Critères de sortie de Phase 2

- [x] `requireProductionEnv` testée unitairement (4 cas) avec 100% coverage
- [x] `main.ts` utilise `requireProductionEnv` — le serveur refuse de démarrer en prod sans `NEW_RELIC_LICENSE_KEY`
- [x] `PrismaService` log les requêtes > 200ms en `NODE_ENV=development` via `$extends` query extension
- [x] `pnpm typecheck` vert sur backend
- [x] `pnpm test` vert : tous les tests passent
- [x] ADR-006 et ADR-007 dans `docs/architecture/README.md`
- [x] CI GitHub Actions entièrement verte
