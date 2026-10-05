# Phase 4 — Job Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rendre les jobs BullMQ résilients : retry automatique avec backoff exponentiel, rétention des jobs en échec pour investigation, suppression du cast `as unknown as`, et exposition des métriques de queue dans `GET /health`.

**Architecture:** Trois axes indépendants — (1) configuration `defaultJobOptions` pour le retry/rétention dans les modules qui enregistrent les queues, (2) alignement des types dans `sync.processor.ts` pour supprimer un cast unsafe, (3) injection des queues dans `HealthService` pour exposer les compteurs waiting/active/failed dans le health check.

**Tech Stack:** NestJS 11, BullMQ 5, @nestjs/bullmq, TypeScript 5.6, Jest 29

---

## Fichiers impactés

### Modifier

- `apps/backend/src/tracks/tracks.module.ts` — `defaultJobOptions` sur la queue `track-processing`
- `apps/backend/src/competitions/competitions.module.ts` — `defaultJobOptions` sur la queue `ffd-sync`
- `apps/backend/src/competitions/sync.processor.ts` — aligner `SyncResult` avec le retour réel de `syncFFDCompetitions`
- `apps/backend/src/health/health.module.ts` — importer `BullModule.registerQueue` pour les deux queues
- `apps/backend/src/health/health.service.ts` — injecter les queues, ajouter `checkQueues()`, exposer dans `HealthStatus`
- `apps/backend/src/health/health.service.spec.ts` — ajouter les cas de test queues

### Pas touché

- `apps/backend/src/tracks/track.processor.ts` — la logique de retry est dans BullMQ, pas dans le processor
- `apps/backend/src/competitions/competition-sync.service.ts` — inchangé
- Tous les autres modules

---

## Task 1 — Retry avec backoff exponentiel + rétention des jobs en échec

**Files:**

- Modify: `apps/backend/src/tracks/tracks.module.ts`
- Modify: `apps/backend/src/competitions/competitions.module.ts`

BullMQ exécute un job une seule fois par défaut. Sans `attempts`, un job réseau échoué (timeout yt-dlp, FFD API down) est perdu définitivement. Sans `removeOnFail: false`, les jobs échoués sont supprimés de Redis et ne peuvent pas être inspectés a posteriori.

La configuration se fait dans `BullModule.registerQueue()` via `defaultJobOptions`. Cela s'applique à tous les jobs ajoutés à la queue sauf si overridé au moment de l'`add()`.

- [x] **Step 1 : Lancer les tests existants pour établir la baseline**

```bash
cd apps/backend && pnpm test src/tracks/track.processor.spec.ts src/competitions/sync.processor.spec.ts
```

Expected : tous les tests passent. Note le nombre de tests (doit rester stable).

- [x] **Step 2 : Modifier `tracks.module.ts` pour ajouter `defaultJobOptions`**

Dans `apps/backend/src/tracks/tracks.module.ts`, remplacer :

```typescript
BullModule.registerQueue({ name: "track-processing" }),
```

par :

```typescript
BullModule.registerQueue({
  name: "track-processing",
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
}),
```

**Explication des valeurs :**

- `attempts: 3` — BullMQ retente le job 2 fois après le premier échec (total 3 exécutions)
- `backoff: exponential, delay: 2000` — délais : 2s, 4s entre les tentatives
- `removeOnComplete: { count: 50 }` — garde les 50 derniers jobs réussis dans Redis (pour debug)
- `removeOnFail: { count: 100 }` — garde les 100 derniers jobs échoués dans Redis (pour investigation)

- [x] **Step 3 : Modifier `competitions.module.ts` pour ajouter `defaultJobOptions`**

Dans `apps/backend/src/competitions/competitions.module.ts`, remplacer :

```typescript
BullModule.registerQueue({ name: "ffd-sync" }),
```

par :

```typescript
BullModule.registerQueue({
  name: "ffd-sync",
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
}),
```

**Note sur les délais ffd-sync :** L'API FFD peut être lente — 5s de backoff initial (→ 10s pour la 3e tentative) est plus adapté qu'un retry immédiat.

- [x] **Step 4 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur. `defaultJobOptions` est typé par `@nestjs/bullmq` — aucun `any` introduit.

- [x] **Step 5 : Relancer les tests**

```bash
cd apps/backend && pnpm test src/tracks/track.processor.spec.ts src/competitions/sync.processor.spec.ts
```

Expected : même nombre de tests, tous verts. La config `defaultJobOptions` ne change pas le comportement des processors eux-mêmes.

- [x] **Step 6 : Commit**

```bash
git add apps/backend/src/tracks/tracks.module.ts apps/backend/src/competitions/competitions.module.ts
git commit -m "feat(queues): add retry (3 attempts, exponential backoff) and job retention to BullMQ queues"
```

---

## Task 2 — Supprimer le cast unsafe dans `sync.processor.ts`

**Files:**

- Modify: `apps/backend/src/competitions/sync.processor.ts`
- Modify: `apps/backend/src/competitions/sync.processor.spec.ts`

Le cast `as unknown as Promise<SyncResult>` existe parce que `syncFFDCompetitions()` retourne `{ synced: number, failed: number }` mais `SyncResult` attendait `{ competitionsAdded, competitionsUpdated, failed }`. Solution : aligner `SyncResult` avec ce que le service retourne réellement.

- [x] **Step 1 : Vérifier le retour réel de `syncFFDCompetitions`**

```bash
grep -n "return {" apps/backend/src/competitions/services/competition-sync.service.ts
```

Expected : ligne ~95 `return { synced: syncedCount, failed: failedCount };`

- [x] **Step 2 : Mettre à jour `SyncResult` et supprimer le cast**

Dans `apps/backend/src/competitions/sync.processor.ts`, remplacer le fichier entier par :

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CompetitionSyncService } from './services/competition-sync.service';

export interface SyncResult {
  synced: number;
  failed: number;
}

@Processor('ffd-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: CompetitionSyncService) {
    super();
  }

  async process(job: Job): Promise<SyncResult> {
    this.logger.log(`Starting FFD sync job ${job.id ?? ''}`);
    return this.syncService.syncFFDCompetitions();
  }
}
```

- [x] **Step 3 : Mettre à jour le spec pour utiliser la nouvelle forme de `SyncResult`**

Dans `apps/backend/src/competitions/sync.processor.spec.ts`, remplacer le mock de retour :

```typescript
const makeSyncService = () => ({
  syncFFDCompetitions: jest.fn().mockResolvedValue({
    synced: 4,
    failed: 0,
  }),
});
```

Et mettre à jour l'assertion dans le test `"calls syncFFDCompetitions and returns the result"` :

```typescript
expect(result).toEqual({
  synced: 4,
  failed: 0,
});
```

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/competitions/sync.processor.spec.ts
```

Expected : 2/2 PASS.

- [x] **Step 5 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur. Le cast `as unknown as` est supprimé.

- [x] **Step 6 : Commit**

```bash
git add apps/backend/src/competitions/sync.processor.ts apps/backend/src/competitions/sync.processor.spec.ts
git commit -m "fix(sync): align SyncResult type with syncFFDCompetitions return value, remove unsafe cast"
```

---

## Task 3 — Métriques de queue dans `GET /health`

**Files:**

- Modify: `apps/backend/src/health/health.module.ts`
- Modify: `apps/backend/src/health/health.service.ts`
- Modify: `apps/backend/src/health/health.service.spec.ts`

`GET /health` surveille la DB et Redis mais ignore les queues. Un backlog de 500 jobs en `waiting` ou 20 jobs en `failed` est un signal critique invisible aujourd'hui.

Pour injecter une `Queue` BullMQ dans un service NestJS, on utilise `@InjectQueue('queue-name')` (decorator de `@nestjs/bullmq`) et on enregistre la queue dans le module via `BullModule.registerQueue()`. Les deux queues étant déjà enregistrées dans leurs modules respectifs, on doit les ré-enregistrer dans `HealthModule` — c'est le pattern NestJS normal (pas de duplication de configuration, juste d'enregistrement).

- [x] **Step 1 : Écrire les tests failing pour les métriques de queue**

Dans `apps/backend/src/health/health.service.spec.ts`, ajouter les mocks de Queue et les cas de test.

Ajouter les imports en tête du fichier :

```typescript
import { getQueueToken } from '@nestjs/bullmq';
```

Ajouter les mocks de Queue après les mocks existants (`mockRedisService`) :

```typescript
const mockTrackQueue = {
  getJobCounts: jest.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    failed: 0,
    delayed: 0,
    completed: 0,
  }),
};

const mockSyncQueue = {
  getJobCounts: jest.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    failed: 0,
    delayed: 0,
    completed: 0,
  }),
};
```

Mettre à jour la création du module de test (`Test.createTestingModule`) pour injecter les queues :

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    HealthService,
    { provide: PrismaService, useValue: mockPrisma },
    { provide: RedisService, useValue: mockRedisService },
    { provide: getQueueToken('track-processing'), useValue: mockTrackQueue },
    { provide: getQueueToken('ffd-sync'), useValue: mockSyncQueue },
  ],
}).compile();
```

Ajouter dans `beforeEach` après les clears existants :

```typescript
mockTrackQueue.getJobCounts.mockResolvedValue({
  waiting: 0,
  active: 0,
  failed: 0,
  delayed: 0,
  completed: 0,
});
mockSyncQueue.getJobCounts.mockResolvedValue({
  waiting: 0,
  active: 0,
  failed: 0,
  delayed: 0,
  completed: 0,
});
```

Ajouter un nouveau `describe` block après les existants :

```typescript
describe('queues', () => {
  it('should include queue metrics in health check result', async () => {
    const result = await service.check();
    expect(result).toHaveProperty('queues');
    expect(result.queues['track-processing']).toEqual({
      status: 'ok',
      waiting: 0,
      active: 0,
      failed: 0,
    });
    expect(result.queues['ffd-sync']).toEqual({
      status: 'ok',
      waiting: 0,
      active: 0,
      failed: 0,
    });
  });

  it('should return degraded status when a queue has failed jobs', async () => {
    mockTrackQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      failed: 5,
      delayed: 0,
      completed: 10,
    });

    const result = await service.check();
    expect(result.status).toBe('degraded');
    expect(result.queues['track-processing'].status).toBe('degraded');
    expect(result.queues['track-processing'].failed).toBe(5);
  });

  it('should return degraded status when a queue has stalled jobs (waiting > 100)', async () => {
    mockSyncQueue.getJobCounts.mockResolvedValue({
      waiting: 150,
      active: 0,
      failed: 0,
      delayed: 0,
      completed: 0,
    });

    const result = await service.check();
    expect(result.status).toBe('degraded');
    expect(result.queues['ffd-sync'].status).toBe('degraded');
    expect(result.queues['ffd-sync'].waiting).toBe(150);
  });

  it('should return error in queue status when getJobCounts throws', async () => {
    mockTrackQueue.getJobCounts.mockRejectedValue(new Error('Redis timeout'));

    const result = await service.check();
    expect(result.queues['track-processing'].status).toBe('error');
    expect(result.queues['track-processing']).toHaveProperty('error');
  });
});
```

- [x] **Step 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
cd apps/backend && pnpm test src/health/health.service.spec.ts
```

Expected : FAIL — `HealthService` ne reconnaît pas encore les queues injectées.

- [x] **Step 3 : Mettre à jour `HealthService` pour injecter les queues et ajouter `checkQueues()`**

Dans `apps/backend/src/health/health.service.ts`, remplacer le contenu entier par :

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface QueueHealth {
  status: 'ok' | 'degraded' | 'error';
  waiting: number;
  active: number;
  failed: number;
  error?: string;
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  database: {
    status: 'ok' | 'error';
    responseTime?: number;
    error?: string;
  };
  redis: {
    status: 'ok' | 'error';
    responseTime?: number;
    error?: string;
  };
  queues: Record<string, QueueHealth>;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
}

interface Metrics {
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
  };
  requests: {
    total: number;
    errors: number;
  };
}

// Seuils pour détecter une queue en mauvaise santé
const QUEUE_FAILED_THRESHOLD = 1; // Tout job en échec est un signal
const QUEUE_WAITING_THRESHOLD = 100; // > 100 jobs en attente = backlog anormal

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue('track-processing') private readonly trackQueue: Queue,
    @InjectQueue('ffd-sync') private readonly syncQueue: Queue,
  ) {}

  async check(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const dbCheck = await this.checkDatabase();
    const redisCheck = await this.checkRedis();
    const queuesCheck = await this.checkQueues();

    const memoryUsage = process.memoryUsage();
    const memory = {
      used: memoryUsage.heapUsed,
      total: memoryUsage.heapTotal,
      percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
    };

    const queuesDegraded = Object.values(queuesCheck).some((q) => q.status !== 'ok');

    let status: 'ok' | 'degraded' | 'down' = 'ok';
    if (dbCheck.status === 'error' || redisCheck.status === 'error' || queuesDegraded) {
      status = 'degraded';
    }
    if (dbCheck.status === 'error' && redisCheck.status === 'error') {
      status = 'down';
    }

    return {
      status,
      timestamp,
      uptime,
      database: dbCheck,
      redis: redisCheck,
      queues: queuesCheck,
      memory,
    };
  }

  private async checkDatabase(): Promise<{
    status: 'ok' | 'error';
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Database connection failed';
      this.logger.error('Database health check failed', error);
      return { status: 'error', error: errorMessage };
    }
  }

  private async checkRedis(): Promise<{
    status: 'ok' | 'error';
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      if (!this.redis.isAvailable()) {
        return { status: 'error', error: 'Redis not available' };
      }
      const client = this.redis.getClient();
      if (!client) {
        return { status: 'error', error: 'Redis client not initialized' };
      }
      await client.ping();
      return { status: 'ok', responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Redis connection failed';
      this.logger.warn('Redis health check failed', error);
      return { status: 'error', error: errorMessage };
    }
  }

  private async checkQueues(): Promise<Record<string, QueueHealth>> {
    const queues: Record<string, Queue> = {
      'track-processing': this.trackQueue,
      'ffd-sync': this.syncQueue,
    };

    const results: Record<string, QueueHealth> = {};

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'failed',
          'delayed',
          'completed',
        );
        const { waiting, active, failed } = counts;

        let queueStatus: 'ok' | 'degraded' = 'ok';
        if (failed >= QUEUE_FAILED_THRESHOLD || waiting > QUEUE_WAITING_THRESHOLD) {
          queueStatus = 'degraded';
        }

        results[name] = { status: queueStatus, waiting, active, failed };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Queue check failed';
        this.logger.warn(`Queue ${name} health check failed`, error);
        results[name] = {
          status: 'error',
          waiting: 0,
          active: 0,
          failed: 0,
          error: errorMessage,
        };
      }
    }

    return results;
  }

  getMetrics(): Metrics {
    const memoryUsage = process.memoryUsage();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      uptime,
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpu: {
        usage: process.cpuUsage().user / 1000000,
      },
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
      },
    };
  }

  incrementRequestCount(): void {
    this.requestCount++;
  }

  incrementErrorCount(): void {
    this.errorCount++;
  }
}
```

- [x] **Step 4 : Mettre à jour `HealthModule` pour enregistrer les queues**

Dans `apps/backend/src/health/health.module.ts`, remplacer par :

```typescript
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({ name: 'track-processing' }, { name: 'ffd-sync' }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
```

**Note :** `BullModule.registerQueue()` dans `HealthModule` ne duplique pas la configuration `defaultJobOptions` — elle est définie dans `TracksModule` et `CompetitionsModule`. Ici on enregistre juste le token d'injection pour que NestJS sache comment fournir les instances `Queue`.

- [x] **Step 5 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/health/health.service.spec.ts
```

Expected : tous les tests passent (anciens + nouveaux).

- [x] **Step 6 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 7 : Lancer tous les tests du backend**

```bash
cd apps/backend && pnpm test
```

Expected : 0 échec.

- [x] **Step 8 : Commit**

```bash
git add apps/backend/src/health/health.module.ts apps/backend/src/health/health.service.ts apps/backend/src/health/health.service.spec.ts
git commit -m "feat(health): expose BullMQ queue metrics (waiting/active/failed) in GET /health"
```

---

## Critères de sortie de Phase 4

- [x] Jobs BullMQ retentés 3 fois avec backoff exponentiel (2s pour tracks, 5s pour sync)
- [x] Jobs en échec conservés dans Redis (`removeOnFail: { count: 100 }`) pour investigation
- [x] Cast `as unknown as Promise<SyncResult>` supprimé de `sync.processor.ts`
- [x] `GET /health` expose les compteurs `waiting`, `active`, `failed` pour chaque queue
- [x] `GET /health` retourne `degraded` si ≥ 1 job en échec ou > 100 en attente
- [x] `pnpm typecheck` vert
- [x] `pnpm test` vert (tous les tests existants + nouveaux)
- [x] CI GitHub Actions entièrement verte
