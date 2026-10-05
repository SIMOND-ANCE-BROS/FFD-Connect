# Phase 3 — Async Background Jobs Design

**Date:** 2026-03-26

## Objectif

Rendre les opérations longues non-bloquantes pour l'utilisateur : le traitement de tracks (yt-dlp + BPM) et la synchronisation FFD passent en background via une job queue BullMQ. L'UI reçoit immédiatement un `jobId` et poll pour le statut.

## Contexte

Le projet dispose déjà de rate limiting, pagination, health checks et validation stricte. Les deux seuls points bloquants pour l'UX sont :

- `POST /tracks/process` — télécharge via yt-dlp (timeout 2min) + analyse BPM. Bloque la requête HTTP jusqu'à la fin.
- `POST /competitions/sync` — appelle l'API FFD en batches. Bloque la requête HTTP.

Redis est déjà présent dans le stack (cache + sessions). BullMQ est le choix naturel.

## Architecture

### Stack

- `bullmq` + `@nestjs/bullmq` (wrapper NestJS officiel)
- Redis existant partagé entre cache, sessions, et queues — configuré via `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (variables déjà validées dans `env.validation.ts`)
- Workers dans le même process NestJS (pas de process séparé nécessaire à cette échelle)
- Note : BullMQ crée son propre pool de connexions `ioredis` indépendant de `RedisService` — comportement standard, pas de conflit

### Deux queues

| Queue              | Producteur            | Worker           |
| ------------------ | --------------------- | ---------------- |
| `track-processing` | `TracksService`       | `TrackProcessor` |
| `ffd-sync`         | `CompetitionsService` | `SyncProcessor`  |

### Statuts exposés

BullMQ stocke nativement les statuts dans Redis. On les expose via endpoints de polling :

```
pending → active → completed
                 → failed
```

## Design détaillé

### 1. Infrastructure BullMQ (`app.module.ts`)

`BullModule.forRootAsync()` configuré avec `REDIS_HOST`, `REDIS_PORT`, et `REDIS_PASSWORD` via `ConfigService` (identique à la configuration existante de `RedisService`). Chaque module enregistre sa propre queue via `BullModule.registerQueue()`.

### 2. Track processing

#### Schéma Prisma — ajout `status` sur `Track`

```prisma
model Track {
  id        String      @id @default(uuid())
  title     String
  artist    String
  filename  String
  artwork   String?
  style     String?
  bpm       Float       @default(0)
  status    TrackStatus @default(PENDING)
  jobId     String?
  createdAt DateTime    @default(now())
}

enum TrackStatus {
  PENDING
  READY
  ERROR
}
```

**Note sur `bpm @default(0)` :** Le champ `bpm` est non-nullable dans le schéma actuel. Sous le nouveau flow, le `Track` est créé en DB avant que le BPM soit connu (statut `PENDING`). La valeur `0` est utilisée comme placeholder — elle est écrasée par le worker une fois l'analyse terminée. Le worker met à jour `bpm`, `title`, `artist`, `style`, et `status: READY` en une seule opération.

**Migration des données existantes :** Tous les `Track` existants ont été créés avec `bpm` renseigné via l'ancien flow synchrone. La migration Prisma doit :

1. Ajouter la colonne `status TrackStatus DEFAULT 'PENDING'` et `jobId String?`
2. Immédiatement exécuter `UPDATE "Track" SET status = 'READY'` pour les tracks existantes
3. Ajouter `bpm @default(0)`

La migration est écrite à la main (pas auto-générée) pour inclure le `UPDATE` de données.

#### Flow

**Avant :**

```
POST /tracks/process → download (2min) → BPM → DB → 200 { track }
```

**Après :**

```
POST /tracks/process → validate URL → create Track{status:PENDING} → enqueue job → 202 { jobId, trackId }
Worker: download → BPM → update Track{status:READY, bpm, ...}
GET /tracks/jobs/:jobId → { status, trackId?, error? }
```

#### Endpoints

- `POST /tracks/process` — valide l'URL, crée le record `Track` en DB avec `status: PENDING`, enqueue le job, retourne `202 { jobId, trackId }`
- `GET /tracks/jobs/:jobId` — retourne `{ status: 'pending'|'active'|'completed'|'failed', trackId?, error? }`

#### Worker `TrackProcessor`

Reprend la logique actuellement dans `TracksService` :

1. Fetch metadata (si non-YouTube)
2. `DownloadService.downloadTrack()` avec `withTimeout(120_000)`
3. `finalizeTrack()` : parsing filename, BPM analysis, MPM calculation
4. Update `Track` en DB avec `status: READY` et les métadonnées
5. Sur échec : `status: ERROR`

**Retry :** 3 tentatives avec backoff exponentiel (configurable BullMQ). Après 3 échecs, le job est `failed` et le `Track` passe à `ERROR`.

### 3. FFD Sync

#### Flow

**Avant :**

```
POST /competitions/sync → fetch FFD API → upsert batches → invalidate cache → 200 { stats }
```

**Après :**

```
POST /competitions/sync → check no active sync → enqueue job → 202 { jobId }
Worker: fetch FFD → upsert batches → invalidate cache
GET /competitions/sync/status → { status, stats? }
```

#### Endpoints

- `POST /competitions/sync` — vérifie qu'aucune sync n'est déjà `active` (sinon `409 Conflict`), enqueue le job, retourne `202 { jobId }`
- `GET /competitions/sync/status` — retourne le statut du dernier job de sync : `{ status, jobId, stats?, error? }`

#### Worker `SyncProcessor`

Reprend la logique de `CompetitionSyncService.syncFFDCompetitions()` :

1. Build FFD API URL
2. Fetch + upsert en batches de 5 (`Promise.allSettled`)
3. Invalidate caches
4. Retourne `{ competitionsAdded, competitionsUpdated, failed }`

**Une seule sync concurrente :** `CompetitionsService` appelle `queue.getJobs(['active', 'waiting', 'delayed'])` avant d'enqueue. Si au moins un job est trouvé, retourne `409 Conflict`. Cette approche couvre tous les états intermédiaires (pas seulement `active`).

**Persistance du dernier `jobId` :** Le `jobId` retourné par chaque enqueue est stocké dans Redis sous la clé `ffd-sync:latest-job-id`. `GET /competitions/sync/status` lit cette clé pour retrouver le job et exposer son statut via `queue.getJob(jobId)`.

### 4. Ce qui ne change pas

- Le throttle `@Throttle` sur `POST /competitions/sync` reste (protège contre les abus)
- La logique métier dans `DownloadService`, `BpmService`, `CompetitionSyncService` n'est pas touchée — les processors appellent les mêmes services
- Les endpoints existants de lecture (`GET /tracks`, `GET /competitions`) sont inchangés — `status` et `jobId` ne sont **pas** exposés dans les réponses de liste (uniquement via `GET /tracks/jobs/:jobId`). `TRACK_BASE_SELECT` dans `TracksService` n'inclut pas ces nouveaux champs.
- Pas de Bull Board admin (YAGNI)

## Fichiers impactés

### Créer

- `apps/backend/src/tracks/track.processor.ts`
- `apps/backend/src/competitions/sync.processor.ts`

### Modifier

- `apps/backend/src/app.module.ts` — `BullModule.forRootAsync()`
- `apps/backend/src/tracks/tracks.module.ts` — `BullModule.registerQueue('track-processing')`
- `apps/backend/src/tracks/tracks.controller.ts` — `POST /tracks/process` → 202, `GET /tracks/jobs/:jobId`
- `apps/backend/src/tracks/tracks.service.ts` — enqueue au lieu de traiter inline
- `apps/backend/src/competitions/competitions.module.ts` — `BullModule.registerQueue('ffd-sync')`
- `apps/backend/src/competitions/competitions.controller.ts` — `POST /competitions/sync` → 202, `GET /competitions/sync/status`
- `apps/backend/src/competitions/competitions.service.ts` — enqueue + check concurrence
- `apps/backend/prisma/schema.prisma` — `TrackStatus` enum + `status` + `jobId` sur `Track`
- `apps/backend/prisma/migrations/` — migration pour `TrackStatus`

### Packages à ajouter

```bash
pnpm add bullmq @nestjs/bullmq
```

## Tests

- `TrackProcessor` : mock `DownloadService` et `BpmService`, vérifier les transitions de statut (`PENDING → READY` sur succès, `PENDING → ERROR` sur échec)
- `SyncProcessor` : mock `CompetitionSyncService`, vérifier l'appel et le retour de stats
- `TracksController` : vérifier que `POST /tracks/process` retourne 202 avec `jobId` et `trackId`
- `CompetitionsService` : vérifier 409 si `getJobs(['active', 'waiting', 'delayed'])` retourne des jobs (test de la logique de guard, pas seulement le controller)
- `CompetitionsController` : vérifier 202 sur enqueue, 409 si sync déjà active (via service mocké)
- `GET /tracks/jobs/:jobId` : vérifier le mapping statut BullMQ → réponse API (`pending`, `active`, `completed`, `failed`)
- `GET /competitions/sync/status` : vérifier que le `jobId` Redis est lu et que le statut BullMQ est retourné correctement

## Critères de sortie

- [ ] `POST /tracks/process` retourne 202 immédiatement avec `jobId` et `trackId`
- [ ] `GET /tracks/jobs/:jobId` retourne le statut du job
- [ ] `Track.status` reflète l'état de traitement (`PENDING → READY | ERROR`)
- [ ] `POST /competitions/sync` retourne 202 avec `jobId`
- [ ] `GET /competitions/sync/status` retourne le statut de la dernière sync
- [ ] 409 si une sync est déjà en cours
- [ ] `pnpm typecheck` vert
- [ ] `pnpm test` vert (tous les tests existants + nouveaux)
