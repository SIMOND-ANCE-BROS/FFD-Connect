# Phase 3 — Async Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rendre le traitement de tracks (yt-dlp + BPM) et la sync FFD non-bloquants via BullMQ — l'API répond en <100ms et le job s'exécute en background.

**Architecture:** Deux queues BullMQ (`track-processing`, `ffd-sync`) configurées sur le Redis existant (REDIS_HOST/PORT/PASSWORD). `TracksService.processUrl` devient `enqueueTrack` qui crée un `Track{status:PENDING}` et enqueue un job. `TrackProcessor` exécute le download+BPM en background et met à jour le Track. `CompetitionsService.syncFFDCompetitions` devient `enqueueSyncFFD` avec garde 409 si sync déjà en cours.

**Tech Stack:** NestJS 11, `@nestjs/bullmq` + `bullmq`, Prisma 7, Redis 7 (déjà en place), TypeScript 5.6

---

## Structure des fichiers

### Créer

- `apps/backend/src/tracks/track.processor.ts` — Worker BullMQ qui exécute download + BPM + met à jour Track en DB
- `apps/backend/src/competitions/sync.processor.ts` — Worker BullMQ qui appelle `CompetitionSyncService`
- `apps/backend/prisma/migrations/20260326000001_add_track_status_async/migration.sql` — Enum TrackStatus + colonnes status/jobId + data migration

### Modifier

- `apps/backend/src/app.module.ts` — Ajouter `BullModule.forRootAsync()`
- `apps/backend/src/config/env.validation.ts` — Ajouter `REDIS_PASSWORD`
- `apps/backend/prisma/schema.prisma` — Enum `TrackStatus` + `status`/`jobId`/`bpm @default(0)` sur `Track`
- `apps/backend/src/tracks/tracks.module.ts` — Ajouter `BullModule.registerQueue` + `TrackProcessor`
- `apps/backend/src/tracks/tracks.service.ts` — Remplacer `processUrl`/`finalizeTrack` par `enqueueTrack`/`getJobStatus`; retirer `BpmService`/`DownloadService`; filtrer PENDING dans `findAll`
- `apps/backend/src/tracks/tracks.controller.ts` — POST → 202, ajouter `GET /tracks/jobs/:jobId`
- `apps/backend/src/competitions/competitions.module.ts` — Ajouter `BullModule.registerQueue` + `SyncProcessor`
- `apps/backend/src/competitions/competitions.service.ts` — Remplacer `syncFFDCompetitions` par `enqueueSyncFFD` + ajouter `getSyncStatus`
- `apps/backend/src/competitions/competitions.controller.ts` — POST sync → 202, ajouter `GET /competitions/sync/status`

---

## Task 1 : Installation BullMQ + configuration Redis + env

**Files:**

- Modify: `apps/backend/src/app.module.ts`
- Modify: `apps/backend/src/config/env.validation.ts`

- [x] **Step 1 : Installer les packages**

```bash
cd apps/backend && pnpm add bullmq @nestjs/bullmq
```

Expected : packages ajoutés sans erreur.

- [x] **Step 2 : Ajouter `REDIS_PASSWORD` dans `env.validation.ts`**

Dans `apps/backend/src/config/env.validation.ts`, après la ligne `REDIS_PORT` (ligne ~54), ajouter :

```typescript
  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;
```

- [x] **Step 3 : Ajouter `BullModule.forRootAsync()` dans `app.module.ts`**

Ajouter l'import en haut du fichier :

```typescript
import { BullModule } from '@nestjs/bullmq';
```

Dans le tableau `imports` de `@Module`, ajouter après `ScheduleModule.forRoot()` :

```typescript
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: configService.get<number>("REDIS_PORT", 6379),
          password: configService.get<string>("REDIS_PASSWORD"),
        },
      }),
      inject: [ConfigService],
    }),
```

Ajouter `ConfigService` aux imports si pas déjà présent en haut :

```typescript
import { ConfigService } from '@nestjs/config';
```

- [x] **Step 4 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 5 : Lancer les tests existants**

```bash
cd apps/backend && pnpm test --no-coverage 2>&1 | tail -10
```

Expected : tous les tests passent (aucune régression).

- [x] **Step 6 : Commit**

```bash
git add apps/backend/src/app.module.ts \
        apps/backend/src/config/env.validation.ts \
        apps/backend/package.json \
        pnpm-lock.yaml
git commit -m "feat(bullmq): install @nestjs/bullmq and configure BullModule with Redis"
```

---

## Task 2 : Migration Prisma — TrackStatus

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20260326000001_add_track_status_async/migration.sql`

- [x] **Step 1 : Mettre à jour `schema.prisma`**

Remplacer le model `Track` (lignes 118-127) par :

```prisma
enum TrackStatus {
  PENDING
  READY
  ERROR
}

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
```

- [x] **Step 2 : Créer le fichier de migration à la main**

Créer le dossier et le fichier :

```bash
mkdir -p apps/backend/prisma/migrations/20260326000001_add_track_status_async
```

Contenu de `apps/backend/prisma/migrations/20260326000001_add_track_status_async/migration.sql` :

```sql
-- Phase 3: Add TrackStatus enum and async job tracking fields
-- Migration écrite manuellement pour inclure la data migration (status READY pour les tracks existantes)

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('PENDING', 'READY', 'ERROR');

-- AlterTable: add new columns
ALTER TABLE "Track"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "status" "TrackStatus" NOT NULL DEFAULT 'PENDING';

-- Data migration: tracks already in DB were processed synchronously → mark as READY
UPDATE "Track" SET status = 'READY';

-- AlterTable: add default 0 to bpm (needed for PENDING tracks created before processing)
ALTER TABLE "Track" ALTER COLUMN "bpm" SET DEFAULT 0;
```

- [x] **Step 3 : Appliquer la migration**

```bash
cd apps/backend && pnpm prisma migrate deploy
```

Expected : `1 migration applied`.

Si la DB locale n'est pas accessible, utiliser `prisma migrate dev` (développement uniquement) :

```bash
cd apps/backend && pnpm prisma migrate dev --name add_track_status_async
```

- [x] **Step 4 : Générer le client Prisma**

```bash
cd apps/backend && pnpm prisma generate
```

Expected : client généré avec `TrackStatus` disponible.

- [x] **Step 5 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 6 : Commit**

```bash
git add apps/backend/prisma/schema.prisma \
        apps/backend/prisma/migrations/20260326000001_add_track_status_async/
git commit -m "feat(prisma): add TrackStatus enum (PENDING/READY/ERROR) and jobId field"
```

---

## Task 3 : Queue track-processing — TrackProcessor + refactor TracksService + TracksController

**Files:**

- Create: `apps/backend/src/tracks/track.processor.ts`
- Create: `apps/backend/src/tracks/track.processor.spec.ts`
- Modify: `apps/backend/src/tracks/tracks.service.ts`
- Modify: `apps/backend/src/tracks/tracks.controller.ts`
- Modify: `apps/backend/src/tracks/tracks.module.ts`

### Contexte

Actuellement `TracksService.processUrl` exécute tout en synchrone (download + BPM + DB) et `TracksController.processUrl` retourne 200 après 30-120s.

Après :

- `TracksService.enqueueTrack` : valide l'URL, crée un `Track{status:PENDING}`, enqueue un job, retourne `{ jobId, trackId }` en <100ms
- `TrackProcessor.process` : exécute download + BPM + met à jour Track en DB
- `GET /tracks/jobs/:jobId` : retourne le statut du job

- [x] **Step 1 : Écrire les tests du processor (failing)**

Créer `apps/backend/src/tracks/track.processor.spec.ts` :

```typescript
import { TrackStatus } from '@prisma/client';
import { Job } from 'bullmq';
import * as path from 'path';
import { BpmService } from './bpm.service';
import { DownloadService } from './download.service';
import { TrackJobData, TrackProcessor } from './track.processor';

const makePrisma = () => ({
  track: { update: jest.fn().mockResolvedValue({}) },
});

const makeDownloadService = () => ({
  fetchMetadata: jest.fn().mockResolvedValue({ title: 'Test', artist: 'Artist' }),
  downloadTrack: jest.fn().mockResolvedValue('/uploads/LATIN | Artist - Title (30).mp3'),
});

const makeBpmService = () => ({
  analyzeBpm: jest.fn().mockResolvedValue(120),
  calculateMpm: jest.fn().mockReturnValue(30),
});

const makeJob = (data: TrackJobData): Partial<Job<TrackJobData>> => ({ data });

describe('TrackProcessor', () => {
  let processor: TrackProcessor;
  let prisma: ReturnType<typeof makePrisma>;
  let downloadService: ReturnType<typeof makeDownloadService>;
  let bpmService: ReturnType<typeof makeBpmService>;

  beforeEach(() => {
    prisma = makePrisma();
    downloadService = makeDownloadService();
    bpmService = makeBpmService();
    processor = new TrackProcessor(
      prisma as never,
      downloadService as unknown as DownloadService,
      bpmService as unknown as BpmService,
    );
  });

  it('updates Track to READY on success (YouTube URL skips fetchMetadata)', async () => {
    const job = makeJob({
      trackId: 'track-1',
      url: 'https://youtube.com/watch?v=abc',
      style: 'LATIN',
    });

    await processor.process(job as Job<TrackJobData>);

    expect(downloadService.fetchMetadata).not.toHaveBeenCalled();
    expect(downloadService.downloadTrack).toHaveBeenCalled();
    expect(prisma.track.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'track-1' },
        data: expect.objectContaining({ status: TrackStatus.READY }),
      }),
    );
  });

  it('calls fetchMetadata for non-YouTube URLs', async () => {
    const job = makeJob({ trackId: 'track-2', url: 'https://open.spotify.com/track/abc' });

    await processor.process(job as Job<TrackJobData>);

    expect(downloadService.fetchMetadata).toHaveBeenCalledWith(
      'https://open.spotify.com/track/abc',
    );
  });

  it('updates Track to ERROR and rethrows on download failure', async () => {
    downloadService.downloadTrack.mockRejectedValue(new Error('Network error'));
    const job = makeJob({ trackId: 'track-3', url: 'https://youtube.com/watch?v=xyz' });

    await expect(processor.process(job as Job<TrackJobData>)).rejects.toThrow('Network error');

    expect(prisma.track.update).toHaveBeenCalledWith({
      where: { id: 'track-3' },
      data: { status: TrackStatus.ERROR },
    });
  });
});
```

- [x] **Step 2 : Lancer les tests (failing)**

```bash
cd apps/backend && pnpm test src/tracks/track.processor.spec.ts --no-coverage 2>&1 | tail -20
```

Expected : FAIL (module `./track.processor` introuvable).

- [x] **Step 3 : Créer `track.processor.ts`**

Créer `apps/backend/src/tracks/track.processor.ts` :

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { Job } from 'bullmq';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage, getErrorStack } from '../utils/error.utils';
import { BpmService } from './bpm.service';
import { DownloadService, Metadata } from './download.service';

export interface TrackJobData {
  trackId: string;
  url: string;
  style?: string;
}

@Processor('track-processing')
export class TrackProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackProcessor.name);
  private readonly downloadDir = path.join(process.cwd(), 'uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly downloadService: DownloadService,
    private readonly bpmService: BpmService,
  ) {
    super();
  }

  async process(job: Job<TrackJobData>): Promise<void> {
    const { trackId, url, style } = job.data;
    this.logger.log(`Processing track job ${job.id ?? ''} for track ${trackId}`);

    try {
      let metadata: Metadata | null = null;
      if (!url.match(/youtu/i)) {
        metadata = await this.downloadService.fetchMetadata(url);
      }

      const filePath = await this.downloadService.downloadTrack(url, metadata, this.downloadDir);

      await this.finalizeTrack(trackId, filePath, style);
    } catch (error: unknown) {
      this.logger.error(`Track job ${job.id ?? ''} failed`, getErrorStack(error));
      await this.prisma.track.update({
        where: { id: trackId },
        data: { status: TrackStatus.ERROR },
      });
      throw error;
    }
  }

  private async finalizeTrack(trackId: string, filePath: string, style?: string): Promise<void> {
    const filename = path.basename(filePath);

    const regex = /^(\d+-)?(.*?)\s*[|｜]\s*(.*?)\s*-\s*(.*?)(?:\((\d+)\s*(?:BPM|MPM)?\))?\.mp3$/i;
    const match = filename.match(regex);

    let artist = 'Unknown';
    let title = filename.replace(/\.[^/.]+$/, '').replace(/^\d+-/, '');
    let detectedStyle = style ?? 'Unknown';
    let hintBpm = 0;

    if (match) {
      detectedStyle = match[2].trim().toUpperCase();
      artist = match[3].trim();
      title = match[4].trim();
      if (match[5]) hintBpm = parseInt(match[5], 10);
    }

    let bpm = 0;
    try {
      this.logger.log(`Analyzing BPM for ${filePath}`);
      const rawBpm = await this.bpmService.analyzeBpm(filePath);
      const calculatedMpm = this.bpmService.calculateMpm(rawBpm, detectedStyle);

      if (hintBpm > 0) {
        let targetMpm = hintBpm;
        if (targetMpm > 70) {
          targetMpm = this.bpmService.calculateMpm(hintBpm, detectedStyle);
        }
        bpm = targetMpm;
      } else {
        bpm = calculatedMpm;
      }
    } catch (error: unknown) {
      this.logger.warn(`BPM analysis failed: ${getErrorMessage(error)}`);
      bpm = hintBpm > 70 ? Math.round(hintBpm / 4) : hintBpm;
    }

    await this.prisma.track.update({
      where: { id: trackId },
      data: {
        title,
        artist,
        style: detectedStyle,
        filename,
        bpm: Math.round(bpm),
        artwork: `${filename.replace(/\.[^/.]+$/, '')}.jpg`,
        status: TrackStatus.READY,
      },
    });
  }
}
```

- [x] **Step 4 : Lancer les tests du processor (passing)**

```bash
cd apps/backend && pnpm test src/tracks/track.processor.spec.ts --no-coverage 2>&1 | tail -10
```

Expected : 3/3 PASS.

- [x] **Step 4b : Mettre à jour `tracks.service.spec.ts`**

Le fichier existant teste `processUrl` et `finalizeTrack` via `processUrl` — ces méthodes sont supprimées. La logique `finalizeTrack` est maintenant testée dans `track.processor.spec.ts`. Remplacer le contenu complet du fichier :

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { TrackStatus } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { TracksService } from './tracks.service';

const QUEUE_TOKEN = getQueueToken('track-processing');

describe('TracksService', () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let mockQueue: { add: jest.Mock; getJob: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: QUEUE_TOKEN, useValue: mockQueue },
      ],
    }).compile();

    service = module.get<TracksService>(TracksService);
  });

  describe('findAll', () => {
    it('returns tracks from prisma (status: READY filter applied)', async () => {
      const mockResult = [{ id: '1', title: 'Test', createdAt: new Date() }];
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue(mockResult);
      prisma.track.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.data).toBe(mockResult);
      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ status: TrackStatus.READY })]),
          }),
        }),
      );
    });
  });

  describe('enqueueTrack', () => {
    it('throws BAD_REQUEST for unsupported URLs', async () => {
      await expect(service.enqueueTrack('https://unsupported.com')).rejects.toThrow(
        new HttpException(
          'Unsupported URL. Only Spotify, Deezer, and YouTube are supported.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('creates a PENDING Track and enqueues a job for YouTube URLs', async () => {
      // @ts-expect-error - testing partial return
      prisma.track.create.mockResolvedValue({ id: 'track-abc' });
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      const result = await service.enqueueTrack('https://youtu.be/test', 'LATIN');

      expect(prisma.track.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TrackStatus.PENDING, bpm: 0 }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ trackId: 'track-abc', url: 'https://youtu.be/test' }),
      );
      expect(result).toEqual({ jobId: 'job-1', trackId: 'track-abc' });
    });

    it('creates a PENDING Track for Spotify URLs', async () => {
      // @ts-expect-error - testing partial return
      prisma.track.create.mockResolvedValue({ id: 'track-spotify' });
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      await service.enqueueTrack('https://open.spotify.com/track/abc');

      expect(prisma.track.create).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('returns not_found when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const result = await service.getJobStatus('nonexistent');

      expect(result.status).toBe('not_found');
    });

    it('returns status and trackId when job exists', async () => {
      mockQueue.getJob.mockResolvedValue({
        data: { trackId: 'track-xyz', url: 'https://youtu.be/x' },
        getState: jest.fn().mockResolvedValue('completed'),
        failedReason: undefined,
      });

      const result = await service.getJobStatus('job-1');

      expect(result.status).toBe('completed');
      expect(result.trackId).toBe('track-xyz');
    });

    it('returns error message when job failed', async () => {
      mockQueue.getJob.mockResolvedValue({
        data: { trackId: 'track-fail', url: 'https://youtu.be/x' },
        getState: jest.fn().mockResolvedValue('failed'),
        failedReason: 'yt-dlp error',
      });

      const result = await service.getJobStatus('job-fail');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('yt-dlp error');
    });
  });
});
```

- [x] **Step 4c : Mettre à jour `tracks.controller.spec.ts`**

Le mock du service utilise `processUrl` — remplacer par `enqueueTrack` et `getJobStatus`. Modifier uniquement les lignes concernées :

1. Dans `mockTracksService`, remplacer `processUrl: jest.fn()` par :

```typescript
const mockTracksService = {
  enqueueTrack: jest.fn(),
  getJobStatus: jest.fn(),
  findAll: jest.fn(),
};
```

2. Remplacer le `describe("processUrl", ...)` entier par :

```typescript
describe('processUrl (POST /tracks/process → 202)', () => {
  it('returns jobId and trackId from enqueueTrack', async () => {
    const dto: ProcessTrackDto = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      style: 'Standard',
    };
    mockTracksService.enqueueTrack.mockResolvedValue({
      jobId: 'job-1',
      trackId: 'track-1',
    });

    const result = await controller.processUrl(dto);

    expect(result).toEqual({ jobId: 'job-1', trackId: 'track-1' });
    expect(mockTracksService.enqueueTrack).toHaveBeenCalledWith(dto.url, dto.style);
  });

  it('throws BAD_REQUEST for unsupported URLs', async () => {
    const dto: ProcessTrackDto = { url: 'https://unsupported.com' };
    mockTracksService.enqueueTrack.mockRejectedValue(new BadRequestException('Unsupported URL'));

    await expect(controller.processUrl(dto)).rejects.toThrow(BadRequestException);
  });
});

describe('getJobStatus (GET /tracks/jobs/:jobId)', () => {
  it('returns job status from the service', async () => {
    mockTracksService.getJobStatus.mockResolvedValue({
      status: 'completed',
      trackId: 'track-1',
    });

    const result = await controller.getJobStatus('job-1');

    expect(result).toEqual({ status: 'completed', trackId: 'track-1' });
    expect(mockTracksService.getJobStatus).toHaveBeenCalledWith('job-1');
  });

  it('returns not_found status for unknown jobId', async () => {
    mockTracksService.getJobStatus.mockResolvedValue({ status: 'not_found' });

    const result = await controller.getJobStatus('unknown');

    expect((result as { status: string }).status).toBe('not_found');
  });
});
```

- [x] **Step 5 : Refactorer `tracks.service.ts`**

Remplacer le contenu complet de `apps/backend/src/tracks/tracks.service.ts` :

```typescript
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, TrackStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginationParamsDto } from '../common/dto/pagination-params.dto';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { TrackJobData } from './track.processor';

/** Champs de base récupérés pour toute piste audio. Ne pas exposer status/jobId dans les listes. */
const TRACK_BASE_SELECT = {
  id: true,
  title: true,
  artist: true,
  filename: true,
  artwork: true,
  style: true,
  bpm: true,
  createdAt: true,
} satisfies Prisma.TrackSelect;

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('track-processing') private readonly trackQueue: Queue,
  ) {}

  /** Filtre Prisma : exclut Ambiance et tracks en cours de traitement (PENDING/ERROR). */
  private static readonly LIBRARY_WHERE: Prisma.TrackWhereInput = {
    AND: [
      { artist: { not: { equals: 'Ambiance' }, mode: 'insensitive' } },
      {
        OR: [{ style: { not: { equals: 'Ambiance' }, mode: 'insensitive' } }, { style: null }],
      },
      { status: TrackStatus.READY },
    ],
  };

  /**
   * Récupère toutes les pistes audio READY avec pagination.
   * Exclut Ambiance et les tracks en cours de traitement.
   */
  async findAll(pagination: PaginationParamsDto = new PaginationParamsDto()) {
    const { skip, take } = pagination;
    const where = TracksService.LIBRARY_WHERE;

    const [total, tracks] = await Promise.all([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: TRACK_BASE_SELECT,
      }),
    ]);

    return createPaginatedResponse(tracks, total, skip ?? 0, take ?? 10);
  }

  /**
   * Valide l'URL, crée un Track{status:PENDING} en DB, enqueue le job de traitement.
   * Retourne immédiatement avec jobId et trackId. Le traitement se fait en background.
   */
  async enqueueTrack(url: string, style?: string): Promise<{ jobId: string; trackId: string }> {
    this.logger.log(`Enqueueing track: ${url}`);

    if (!url.match(/spotify|deezer|youtu/i)) {
      throw new HttpException(
        'Unsupported URL. Only Spotify, Deezer, and YouTube are supported.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const track = await this.prisma.track.create({
      data: {
        title: 'Processing...',
        artist: 'Unknown',
        filename: '',
        bpm: 0,
        status: TrackStatus.PENDING,
      },
    });

    const job = await this.trackQueue.add('process', {
      trackId: track.id,
      url,
      style,
    } satisfies TrackJobData);

    await this.prisma.track.update({
      where: { id: track.id },
      data: { jobId: job.id },
    });

    return { jobId: job.id!, trackId: track.id };
  }

  /**
   * Retourne le statut d'un job de traitement de track depuis BullMQ.
   */
  async getJobStatus(jobId: string) {
    const job = await this.trackQueue.getJob(jobId);
    if (!job) {
      return { status: 'not_found' as const };
    }
    const state = await job.getState();
    return {
      status: state,
      trackId: (job.data as TrackJobData).trackId,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  }
}
```

- [x] **Step 6 : Mettre à jour `tracks.controller.ts`**

Remplacer le contenu complet de `apps/backend/src/tracks/tracks.controller.ts` :

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as fs from 'fs';
import { createReadStream } from 'fs';
import * as path from 'path';
import { PaginationParamsDto } from '../common/dto/pagination-params.dto';
import { ProcessTrackDto } from './dto/process-track.dto';
import { TracksService } from './tracks.service';

@ApiTags('tracks')
@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Post('process')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Enqueue le traitement d'une URL de musique",
    description:
      'Crée un job de traitement en background. Retourne immédiatement avec jobId et trackId. Utiliser GET /tracks/jobs/:jobId pour suivre la progression.',
  })
  @ApiBody({ type: ProcessTrackDto })
  @ApiResponse({
    status: 202,
    description: 'Job de traitement créé',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', example: '1' },
        trackId: { type: 'string', example: 'uuid-of-track' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'URL non supportée' })
  async processUrl(@Body() dto: ProcessTrackDto) {
    return this.tracksService.enqueueTrack(dto.url, dto.style);
  }

  @Get('jobs/:jobId')
  @ApiOperation({
    summary: "Statut d'un job de traitement",
    description:
      'Retourne le statut BullMQ du job de traitement (pending, active, completed, failed).',
  })
  @ApiParam({ name: 'jobId', description: 'ID du job retourné par POST /tracks/process' })
  @ApiResponse({
    status: 200,
    description: 'Statut du job',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'active', 'completed', 'failed', 'not_found'],
        },
        trackId: { type: 'string' },
        error: { type: 'string' },
      },
    },
  })
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.tracksService.getJobStatus(jobId);
  }

  @Get()
  @ApiOperation({
    summary: 'Récupère toutes les musiques',
    description:
      'Retourne la liste de toutes les musiques disponibles dans la bibliothèque (status READY uniquement, Ambiance exclue).',
  })
  @ApiResponse({ status: 200, description: 'Liste des musiques' })
  async findAll(@Query() pagination: PaginationParamsDto) {
    return this.tracksService.findAll(pagination);
  }

  @Get('download/:token')
  @ApiOperation({ summary: 'Télécharge un fichier audio' })
  @ApiParam({ name: 'token', description: 'Token de téléchargement sécurisé' })
  @ApiResponse({ status: 200, description: 'Fichier audio' })
  @ApiResponse({ status: 404, description: 'Fichier non trouvé' })
  download(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const safeToken = path.basename(token);
    const filePath = path.join(__dirname, '../../uploads', safeToken);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    const file = createReadStream(filePath);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${decodeURIComponent(safeToken)}"`,
    });

    return new StreamableFile(file);
  }
}
```

- [x] **Step 7 : Mettre à jour `tracks.module.ts`**

Remplacer le contenu de `apps/backend/src/tracks/tracks.module.ts` :

```typescript
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BpmService } from './bpm.service';
import { DownloadService } from './download.service';
import { TrackProcessor } from './track.processor';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

@Module({
  imports: [PrismaModule, HttpModule, BullModule.registerQueue({ name: 'track-processing' })],
  controllers: [TracksController],
  providers: [TracksService, TrackProcessor, BpmService, DownloadService],
  exports: [TracksService],
})
export class TracksModule {}
```

- [x] **Step 8 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/tracks/ --no-coverage 2>&1 | tail -20
```

Si des tests existants sur `TracksService` testent `processUrl`, ils doivent être mis à jour pour tester `enqueueTrack` à la place. Remplacer les appels `tracksService.processUrl(...)` par `tracksService.enqueueTrack(...)`.

Expected : tous les tests du dossier `src/tracks/` passent.

- [x] **Step 9 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 10 : Lancer tous les tests**

```bash
cd apps/backend && pnpm test --no-coverage 2>&1 | tail -10
```

Expected : tous les tests passent.

- [x] **Step 11 : Commit**

```bash
git add apps/backend/src/tracks/
git commit -m "feat(tracks): async track processing via BullMQ — POST /tracks/process returns 202+jobId"
```

---

## Task 4 : Queue ffd-sync — SyncProcessor + refactor CompetitionsService + CompetitionsController

**Files:**

- Create: `apps/backend/src/competitions/sync.processor.ts`
- Create: `apps/backend/src/competitions/sync.processor.spec.ts`
- Modify: `apps/backend/src/competitions/competitions.service.ts`
- Modify: `apps/backend/src/competitions/competitions.controller.ts`
- Modify: `apps/backend/src/competitions/competitions.module.ts`

### Contexte

Actuellement `CompetitionsController.sync()` appelle `competitionsService.syncFFDCompetitions()` qui bloque jusqu'à la fin de la sync FFD. Le résultat de `syncFFDCompetitions()` vient de `CompetitionSyncService` qui fait les appels réseau.

Après :

- `CompetitionsService.enqueueSyncFFD()` : vérifie qu'aucun job n'est en cours, enqueue, stocke le `jobId` dans Redis, retourne `202 { jobId }`
- `SyncProcessor.process()` : appelle `CompetitionSyncService.syncFFDCompetitions()`
- `GET /competitions/sync/status` : lit le `jobId` Redis, retourne l'état BullMQ

- [x] **Step 1 : Écrire les tests du processor (failing)**

Créer `apps/backend/src/competitions/sync.processor.spec.ts` :

```typescript
import { Job } from 'bullmq';
import { CompetitionSyncService } from './services/competition-sync.service';
import { SyncProcessor } from './sync.processor';

const makeSyncService = () => ({
  syncFFDCompetitions: jest.fn().mockResolvedValue({
    competitionsAdded: 3,
    competitionsUpdated: 1,
    failed: 0,
  }),
});

describe('SyncProcessor', () => {
  let processor: SyncProcessor;
  let syncService: ReturnType<typeof makeSyncService>;

  beforeEach(() => {
    syncService = makeSyncService();
    processor = new SyncProcessor(syncService as unknown as CompetitionSyncService);
  });

  it('calls syncFFDCompetitions and returns the result', async () => {
    const job = { id: 'job-1' } as Partial<Job>;

    const result = await processor.process(job as Job);

    expect(syncService.syncFFDCompetitions).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ competitionsAdded: 3, competitionsUpdated: 1, failed: 0 });
  });

  it('propagates errors from syncFFDCompetitions', async () => {
    syncService.syncFFDCompetitions.mockRejectedValue(new Error('FFD API down'));
    const job = { id: 'job-2' } as Partial<Job>;

    await expect(processor.process(job as Job)).rejects.toThrow('FFD API down');
  });
});
```

- [x] **Step 2 : Lancer les tests (failing)**

```bash
cd apps/backend && pnpm test src/competitions/sync.processor.spec.ts --no-coverage 2>&1 | tail -10
```

Expected : FAIL (module `./sync.processor` introuvable).

- [x] **Step 3 : Créer `sync.processor.ts`**

Créer `apps/backend/src/competitions/sync.processor.ts` :

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CompetitionSyncService } from './services/competition-sync.service';

export interface SyncResult {
  competitionsAdded: number;
  competitionsUpdated: number;
  failed?: number;
}

@Processor('ffd-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: CompetitionSyncService) {
    super();
  }

  async process(job: Job): Promise<SyncResult> {
    this.logger.log(`Starting FFD sync job ${job.id ?? ''}`);
    return this.syncService.syncFFDCompetitions() as Promise<SyncResult>;
  }
}
```

- [x] **Step 4 : Lancer les tests du processor (passing)**

```bash
cd apps/backend && pnpm test src/competitions/sync.processor.spec.ts --no-coverage 2>&1 | tail -10
```

Expected : 2/2 PASS.

- [x] **Step 4b : Mettre à jour `competitions.service.spec.ts`**

Le fichier existant teste `syncFFDCompetitions` qui sera supprimée de `CompetitionsService`. La logique est maintenant testée dans `sync.processor.spec.ts`. Le module setup ne fournit pas `getQueueToken('ffd-sync')` ni `RedisService`.

Remplacer le bloc `describe("syncFFDCompetitions")` (lignes ~244-282) par :

```typescript
// enqueueSyncFFD / getSyncStatus
// -------------------------------------------------------------------------

describe('enqueueSyncFFD', () => {
  it('returns jobId when no active sync is in progress', async () => {
    mockSyncQueue.getJobs.mockResolvedValue([]);
    mockSyncQueue.add.mockResolvedValue({ id: 'job-42' });
    mockRedis.set.mockResolvedValue(undefined);

    const result = await service.enqueueSyncFFD();

    expect(result).toEqual({ jobId: 'job-42' });
    expect(mockRedis.set).toHaveBeenCalledWith('ffd-sync:latest-job-id', 'job-42');
  });

  it('throws ConflictException when a sync is already active', async () => {
    mockSyncQueue.getJobs.mockResolvedValue([{ id: 'job-in-progress' }]);

    await expect(service.enqueueSyncFFD()).rejects.toThrow(ConflictException);
  });
});

describe('getSyncStatus', () => {
  it('returns idle when no jobId is stored in Redis', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await service.getSyncStatus();

    expect(result).toEqual({ status: 'idle' });
  });

  it('returns status and stats when job is completed', async () => {
    mockRedis.get.mockResolvedValue('job-99');
    mockSyncQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { competitionsAdded: 5, competitionsUpdated: 2, failed: 0 },
      failedReason: undefined,
    });

    const result = await service.getSyncStatus();

    expect(result.status).toBe('completed');
    expect(result.jobId).toBe('job-99');
    expect(result.stats).toEqual({ competitionsAdded: 5, competitionsUpdated: 2, failed: 0 });
  });

  it('returns error message when job failed', async () => {
    mockRedis.get.mockResolvedValue('job-bad');
    mockSyncQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('failed'),
      returnvalue: undefined,
      failedReason: 'FFD API timeout',
    });

    const result = await service.getSyncStatus();

    expect(result.status).toBe('failed');
    expect(result.error).toBe('FFD API timeout');
  });
});
```

Ajouter également dans les imports en haut du fichier :

```typescript
import { ConflictException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
```

Ajouter dans les mocks en haut :

```typescript
const mockSyncQueue = {
  getJobs: jest.fn(),
  add: jest.fn(),
  getJob: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};
```

Et dans le `Test.createTestingModule`, ajouter :

```typescript
        { provide: getQueueToken("ffd-sync"), useValue: mockSyncQueue },
        { provide: RedisService, useValue: mockRedis },
```

Ainsi que l'import de `RedisService` :

```typescript
import { RedisService } from '../redis/redis.service';
```

- [x] **Step 4c : Mettre à jour `competitions.controller.spec.ts`**

Le mock du service utilise `syncFFDCompetitions` — remplacer par `enqueueSyncFFD` et `getSyncStatus`.

1. Dans `mockCompetitionsService`, remplacer `syncFFDCompetitions: jest.fn()` par :

```typescript
    enqueueSyncFFD: jest.fn(),
    getSyncStatus: jest.fn(),
```

2. Remplacer le `describe("sync", ...)` entier par :

```typescript
describe('sync (POST /competitions/sync → 202)', () => {
  it('calls service.enqueueSyncFFD and returns jobId', async () => {
    service.enqueueSyncFFD.mockResolvedValue({ jobId: 'job-1' });

    const result = await controller.sync();

    expect(service.enqueueSyncFFD).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('propagates ConflictException when sync is already in progress', async () => {
    service.enqueueSyncFFD.mockRejectedValue(
      new ConflictException('A sync is already in progress'),
    );

    await expect(controller.sync()).rejects.toThrow(ConflictException);
  });
});

describe('getSyncStatus (GET /competitions/sync/status)', () => {
  it('returns status from service.getSyncStatus', async () => {
    service.getSyncStatus.mockResolvedValue({ status: 'completed', jobId: 'job-1' });

    const result = await controller.getSyncStatus();

    expect(service.getSyncStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'completed', jobId: 'job-1' });
  });

  it('returns idle when no sync has been run', async () => {
    service.getSyncStatus.mockResolvedValue({ status: 'idle' });

    const result = await controller.getSyncStatus();

    expect((result as { status: string }).status).toBe('idle');
  });
});
```

Ajouter l'import de `ConflictException` dans les imports :

```typescript
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
```

- [x] **Step 5 : Ajouter `enqueueSyncFFD` et `getSyncStatus` dans `competitions.service.ts`**

En haut du fichier, ajouter les imports :

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { SyncResult } from './sync.processor';
```

Dans le constructeur, ajouter les deux injections :

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    private readonly queryService: CompetitionQueryService,
    private readonly registrationService: CompetitionRegistrationService,
    private readonly resultsService: CompetitionResultsService,
    private readonly syncService: CompetitionSyncService,
    @InjectQueue("ffd-sync") private readonly syncQueue: Queue,
    private readonly redisService: RedisService,
  ) {}
```

Remplacer la méthode `syncFFDCompetitions` par :

```typescript
  /**
   * Enqueue une sync FFD en background.
   * Retourne 409 si une sync est déjà active/en attente.
   * Stocke le jobId dans Redis pour GET /competitions/sync/status.
   */
  async enqueueSyncFFD(): Promise<{ jobId: string }> {
    const existing = await this.syncQueue.getJobs([
      "active",
      "waiting",
      "delayed",
    ]);
    if (existing.length > 0) {
      throw new ConflictException(
        "A sync is already in progress. Try again later.",
      );
    }

    const job = await this.syncQueue.add("sync-ffd", {});
    await this.redisService.set("ffd-sync:latest-job-id", job.id!);

    return { jobId: job.id! };
  }

  /**
   * Retourne le statut du dernier job de sync FFD.
   */
  async getSyncStatus(): Promise<{
    status: string;
    jobId?: string;
    stats?: SyncResult;
    error?: string;
  }> {
    const jobId = await this.redisService.get("ffd-sync:latest-job-id");
    if (!jobId) {
      return { status: "idle" };
    }

    const job = await this.syncQueue.getJob(jobId);
    if (!job) {
      return { status: "idle" };
    }

    const state = await job.getState();
    return {
      status: state,
      jobId,
      stats:
        state === "completed"
          ? (job.returnvalue as SyncResult)
          : undefined,
      error: state === "failed" ? job.failedReason : undefined,
    };
  }
```

- [x] **Step 6 : Mettre à jour `competitions.controller.ts` — endpoint sync**

Ajouter `ConflictException, HttpCode, HttpStatus` aux imports depuis `@nestjs/common`.

Remplacer la méthode `sync()` et ajouter `getSyncStatus()` :

```typescript
  @Post("sync")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Lance la synchronisation des compétitions depuis l'API FFD",
    description:
      "Crée un job de sync en background. Retourne immédiatement avec jobId. Utiliser GET /competitions/sync/status pour suivre la progression. Retourne 409 si une sync est déjà en cours.",
  })
  @ApiResponse({
    status: 202,
    description: "Job de sync créé",
    schema: {
      type: "object",
      properties: { jobId: { type: "string", example: "1" } },
    },
  })
  @ApiResponse({ status: 409, description: "Sync déjà en cours" })
  sync() {
    return this.competitionsService.enqueueSyncFFD();
  }

  @Get("sync/status")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Statut de la dernière synchronisation FFD",
    description:
      "Retourne le statut du dernier job de sync (idle, pending, active, completed, failed).",
  })
  @ApiResponse({
    status: 200,
    description: "Statut de la sync",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["idle", "pending", "active", "completed", "failed"] },
        jobId: { type: "string" },
        stats: {
          type: "object",
          properties: {
            competitionsAdded: { type: "number" },
            competitionsUpdated: { type: "number" },
          },
        },
        error: { type: "string" },
      },
    },
  })
  getSyncStatus() {
    return this.competitionsService.getSyncStatus();
  }
```

**Important — ordre des routes :** `GET /competitions/sync/status` doit être déclaré AVANT `GET /competitions/:id` dans le contrôleur pour éviter que NestJS n'interprète `"sync"` comme un paramètre `:id`. Dans le fichier existant `competitions.controller.ts`, `@Get(":id")` est présent. S'assurer que `getSyncStatus()` est placé **avant** la méthode annotée `@Get(":id")` dans le fichier. Vérifier en cherchant `@Get(":id")` dans le fichier et en insérant `getSyncStatus` avant.

- [x] **Step 7 : Mettre à jour `competitions.module.ts`**

Ajouter les imports :

```typescript
import { BullModule } from '@nestjs/bullmq';
import { SyncProcessor } from './sync.processor';
```

Dans le tableau `imports` du `@Module`, ajouter :

```typescript
    BullModule.registerQueue({ name: "ffd-sync" }),
```

Dans `providers`, ajouter `SyncProcessor`.

- [x] **Step 8 : Lancer les tests**

```bash
cd apps/backend && pnpm test src/competitions/ --no-coverage 2>&1 | tail -20
```

Expected : tous les tests du dossier `src/competitions/` passent (les mises à jour ont été faites aux Steps 4b et 4c).

- [x] **Step 9 : Typecheck**

```bash
cd apps/backend && pnpm typecheck
```

Expected : 0 erreur.

- [x] **Step 10 : Lancer tous les tests**

```bash
cd apps/backend && pnpm test --no-coverage 2>&1 | tail -10
```

Expected : tous les tests passent.

- [x] **Step 11 : Commit**

```bash
git add apps/backend/src/competitions/
git commit -m "feat(competitions): async FFD sync via BullMQ — POST /competitions/sync returns 202+jobId"
```

---

## Critères de sortie

- [x] `POST /tracks/process` retourne `202 { jobId, trackId }` en <100ms
- [x] `GET /tracks/jobs/:jobId` retourne `{ status, trackId, error? }`
- [x] `GET /tracks` ne retourne que les tracks `status: READY`
- [x] `POST /competitions/sync` retourne `202 { jobId }` en <100ms
- [x] `POST /competitions/sync` retourne `409` si une sync est déjà active/en attente
- [x] `GET /competitions/sync/status` retourne le statut de la dernière sync
- [x] `pnpm typecheck` vert
- [x] `pnpm test` vert (tous les tests existants + nouveaux)
- [x] Migration Prisma appliquée sans erreur
