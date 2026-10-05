# Competitions Controller Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Supprimer `CompetitionsService` (façade) et faire injecter le controller directement les 4 sous-services spécialisés.

**Architecture:** Créer `CompetitionManagementService` pour le CRUD + sync. Déplacer les méthodes organisateur (`registerMember`, `unregisterMember`, `getPendingRegistrationsForClub`) dans `CompetitionRegistrationService`. Supprimer `CompetitionsService`. Mettre à jour module et controller.

**Tech Stack:** NestJS, Prisma, BullMQ, Redis, TypeScript strict, Jest

---

## Fichiers touchés

- Create: `apps/backend/src/competitions/services/competition-management.service.ts`
- Create: `apps/backend/src/competitions/services/competition-management.service.spec.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`
- Delete: `apps/backend/src/competitions/competitions.service.ts`
- Delete: `apps/backend/src/competitions/competitions.service.spec.ts`
- Modify: `apps/backend/src/competitions/competitions.module.ts`
- Modify: `apps/backend/src/competitions/competitions.controller.ts`

---

## Tâche 1 : Créer CompetitionManagementService

**Files:**

- Create: `apps/backend/src/competitions/services/competition-management.service.ts`
- Create: `apps/backend/src/competitions/services/competition-management.service.spec.ts`

### Contexte

Ce service regroupe 5 méthodes de `CompetitionsService` :

- `getRegulationConstants()` — calcul pur (constantes)
- `enqueueSyncFFD()` — enqueue BullMQ, stocke jobId dans Redis, retourne 409 si job actif
- `getSyncStatus()` — lit jobId Redis, interroge BullMQ, retourne statut/stats/error
- `create(data)` — `prisma.competition.create` avec `COMPETITION_BASE_SELECT`
- `update(id, data)` — `prisma.competition.update` + `cacheService.invalidateCompetition(id)`

`COMPETITION_BASE_SELECT` est exporté depuis `competition-query.service.ts` — l'importer directement.

- [x] **Step 1 : Créer `competition-management.service.ts`**

```typescript
// apps/backend/src/competitions/services/competition-management.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE,
  COMPETITION_TYPES,
  EVENT_KINDS,
  LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE,
} from '../../common/participation-rules';
import { COMPETITION_LEVELS } from '../../common/age-group';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateCompetitionDto, UpdateCompetitionDto } from '../dto/competition-management.dto';
import { CompetitionCacheService } from './competition-cache.service';
import { COMPETITION_BASE_SELECT } from './competition-query.service';
import { SyncResult } from '../sync.processor';

@Injectable()
export class CompetitionManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    @InjectQueue('ffd-sync') private readonly syncQueue: Queue,
    private readonly redisService: RedisService,
  ) {}

  getRegulationConstants() {
    const allowedByType: Record<string, string[]> = {};
    for (const [type, kinds] of Object.entries(ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE)) {
      allowedByType[type] = [...kinds];
    }
    return {
      competitionTypes: [...COMPETITION_TYPES],
      eventKinds: [...EVENT_KINDS],
      competitionLevels: [...COMPETITION_LEVELS],
      allowedEventKindsByCompetitionType: allowedByType,
      levelsForProximiteClassificatrice: [...LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE],
    };
  }

  async enqueueSyncFFD(): Promise<{ jobId: string }> {
    const existing = await this.syncQueue.getJobs(['active', 'waiting', 'delayed']);
    if (existing.length > 0) {
      throw new ConflictException('A sync is already in progress. Try again later.');
    }
    const job = await this.syncQueue.add('sync-ffd', {});
    await this.redisService.set('ffd-sync:latest-job-id', job.id!);
    return { jobId: job.id! };
  }

  async getSyncStatus(): Promise<{
    status: string;
    jobId?: string;
    stats?: SyncResult;
    error?: string;
  }> {
    const jobId = await this.redisService.get('ffd-sync:latest-job-id');
    if (!jobId) return { status: 'idle' };
    const job = await this.syncQueue.getJob(jobId);
    if (!job) return { status: 'idle' };
    const state = await job.getState();
    return {
      status: state,
      jobId,
      stats: state === 'completed' ? (job.returnvalue as SyncResult) : undefined,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  }

  async create(data: CreateCompetitionDto) {
    const { date, layout, ...rest } = data;
    return this.prisma.competition.create({
      data: {
        ...rest,
        date: new Date(date),
        ...(layout !== undefined && {
          layout: layout as Prisma.InputJsonValue,
        }),
      },
      select: COMPETITION_BASE_SELECT,
    });
  }

  async update(id: string, data: UpdateCompetitionDto) {
    const { date, layout, ...rest } = data;
    const updated = await this.prisma.competition.update({
      where: { id },
      data: {
        ...rest,
        ...(date ? { date: new Date(date) } : {}),
        ...(layout !== undefined && {
          layout: layout as Prisma.InputJsonValue,
        }),
      },
      select: COMPETITION_BASE_SELECT,
    });
    await this.cacheService.invalidateCompetition(id);
    return updated;
  }
}
```

- [x] **Step 2 : Créer `competition-management.service.spec.ts`**

```typescript
// apps/backend/src/competitions/services/competition-management.service.spec.ts
import { ConflictException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CompetitionCacheService } from './competition-cache.service';
import { CompetitionManagementService } from './competition-management.service';
import { createMockPrismaService } from '../__mocks__/types';

const mockPrisma = createMockPrismaService();

const mockCache = {
  invalidateCompetition: jest.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
};

const mockQueue = {
  getJobs: jest.fn(),
  add: jest.fn(),
  getJob: jest.fn(),
};

describe('CompetitionManagementService', () => {
  let service: CompetitionManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionManagementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CompetitionCacheService, useValue: mockCache },
        { provide: RedisService, useValue: mockRedis },
        { provide: getQueueToken('ffd-sync'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<CompetitionManagementService>(CompetitionManagementService);
    jest.clearAllMocks();
  });

  describe('getRegulationConstants', () => {
    it('returns competitionTypes, eventKinds, competitionLevels', () => {
      const result = service.getRegulationConstants();
      expect(result.competitionTypes).toBeDefined();
      expect(result.eventKinds).toBeDefined();
      expect(result.competitionLevels).toBeDefined();
      expect(result.allowedEventKindsByCompetitionType).toBeDefined();
    });
  });

  describe('enqueueSyncFFD', () => {
    it('returns jobId when no active sync', async () => {
      mockQueue.getJobs.mockResolvedValue([]);
      mockQueue.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.enqueueSyncFFD();

      expect(result.jobId).toBe('job-1');
      expect(mockRedis.set).toHaveBeenCalledWith('ffd-sync:latest-job-id', 'job-1');
    });

    it('throws ConflictException when a sync is already running', async () => {
      mockQueue.getJobs.mockResolvedValue([{ id: 'job-0' }]);

      await expect(service.enqueueSyncFFD()).rejects.toThrow(ConflictException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('returns idle when no jobId in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getSyncStatus();

      expect(result).toEqual({ status: 'idle' });
    });

    it('returns idle when jobId exists but job not found in queue', async () => {
      mockRedis.get.mockResolvedValue('job-1');
      mockQueue.getJob.mockResolvedValue(null);

      const result = await service.getSyncStatus();

      expect(result).toEqual({ status: 'idle' });
    });

    it('returns completed status with stats', async () => {
      mockRedis.get.mockResolvedValue('job-1');
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: { competitionsAdded: 2, competitionsUpdated: 5 },
        failedReason: undefined,
      });

      const result = await service.getSyncStatus();

      expect(result.status).toBe('completed');
      expect(result.stats).toEqual({ competitionsAdded: 2, competitionsUpdated: 5 });
    });

    it('returns failed status with error', async () => {
      mockRedis.get.mockResolvedValue('job-1');
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
        returnvalue: undefined,
        failedReason: 'Network timeout',
      });

      const result = await service.getSyncStatus();

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Network timeout');
    });
  });

  describe('create', () => {
    it('creates a competition with date converted to Date object', async () => {
      const mockComp = { id: 'comp-1', title: 'Test', date: new Date('2026-06-01') };
      mockPrisma.competition.create.mockResolvedValue(mockComp);

      const result = await service.create({
        title: 'Test',
        date: '2026-06-01',
      } as any);

      expect(mockPrisma.competition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ date: new Date('2026-06-01') }),
        }),
      );
      expect(result).toEqual(mockComp);
    });
  });

  describe('update', () => {
    it('updates competition and invalidates cache', async () => {
      const mockComp = { id: 'comp-1', title: 'Updated' };
      mockPrisma.competition.update.mockResolvedValue(mockComp);

      const result = await service.update('comp-1', { title: 'Updated' } as any);

      expect(mockPrisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'comp-1' } }),
      );
      expect(mockCache.invalidateCompetition).toHaveBeenCalledWith('comp-1');
      expect(result).toEqual(mockComp);
    });
  });
});
```

- [x] **Step 3 : Lancer les tests**

```bash
cd apps/backend && pnpm test competition-management.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 4 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/competitions/services/competition-management.service.ts apps/backend/src/competitions/services/competition-management.service.spec.ts && git commit -m "refactor(competitions): create CompetitionManagementService"
```

---

## Tâche 2 : Déplacer les méthodes organisateur dans CompetitionRegistrationService

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`

### Contexte

Déplacer depuis `CompetitionsService` vers `CompetitionRegistrationService` :

- `registerMember(organizerUserId, eventId, memberUserId, partnerName?, coupleOptions?)` — vérifie l'appartenance au club, puis appelle `this.register()`
- `unregisterMember(organizerUserId, eventId, memberUserId)` — vérifie l'appartenance au club, puis appelle `this.unregister()`
- `getPendingRegistrationsForClub(organizerUserId)` — logique Prisma filtrage par club
- `ensureMemberBelongsToOrganizerClub(organizerUserId, memberUserId)` — méthode privée

Ces méthodes n'ont besoin que de `PrismaService` (déjà injecté) et des méthodes internes `register`/`unregister`.

- [x] **Step 1 : Ajouter les imports manquants à `competition-registration.service.ts`**

Ajouter dans les imports Prisma :

```typescript
import { ..., UserRole } from "@prisma/client";
```

`UserRole` est déjà importé — vérifier qu'il est bien présent (il l'est à la ligne 13).

Ajouter import NotFoundException si pas présent :

```typescript
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
```

- [x] **Step 2 : Ajouter les 4 méthodes à `CompetitionRegistrationService`**

Copier depuis `competitions.service.ts` (lignes 211-396) ces méthodes exactes et les coller avant la fermeture `}` de la classe :

```typescript
  async registerMember(
    organizerUserId: string,
    eventId: string,
    memberUserId: string,
    partnerName?: string,
    coupleOptions?: {
      coupleAgeGroup?: string;
      coupleDisciplineLatin?: boolean;
      coupleDisciplineStandard?: boolean;
      partnerUserId?: string;
      registrantLevel?: string;
    },
  ) {
    await this.ensureMemberBelongsToOrganizerClub(
      organizerUserId,
      memberUserId,
    );
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { competition: true },
    });
    if (!event) throw new NotFoundException("Événement non trouvé");
    return this.register(eventId, memberUserId, partnerName, {
      byOrganizer: true,
      ...coupleOptions,
    });
  }

  async unregisterMember(
    organizerUserId: string,
    eventId: string,
    memberUserId: string,
  ) {
    await this.ensureMemberBelongsToOrganizerClub(
      organizerUserId,
      memberUserId,
    );
    return this.unregister(eventId, memberUserId, {
      byOrganizer: true,
      organizerUserId,
    });
  }

  async getPendingRegistrationsForClub(organizerUserId: string) {
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (organizer?.role !== UserRole.CLUB) return [];

    const sameClubCondition = organizer.clubId
      ? { clubId: organizer.clubId }
      : organizer.clubName?.trim()
        ? {
            clubName: {
              equals: organizer.clubName.trim(),
              mode: "insensitive" as const,
            },
          }
        : null;
    if (!sameClubCondition) return [];

    const pending = await this.prisma.registration.findMany({
      where: { status: "PENDING", user: sameClubCondition },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            clubName: true,
          },
        },
        event: {
          select: {
            id: true,
            category: true,
            ageGroup: true,
            eventType: true,
            competitionId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const competitionIds = [
      ...new Set(pending.map((r) => r.event.competitionId)),
    ] as string[];
    const competitions =
      competitionIds.length > 0
        ? await this.prisma.competition.findMany({
            where: { id: { in: competitionIds } },
            select: { id: true, title: true, date: true },
          })
        : [];

    const compMap = new Map(competitions.map((c) => [c.id, c]));
    return pending.map((r) => ({
      ...r,
      competition: compMap.get(r.event.competitionId) ?? null,
    }));
  }

  private async ensureMemberBelongsToOrganizerClub(
    organizerUserId: string,
    memberUserId: string,
  ) {
    const [organizer, member] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: organizerUserId },
        select: { role: true, clubId: true, clubName: true },
      }),
      this.prisma.user.findUnique({
        where: { id: memberUserId },
        select: { clubId: true, clubName: true },
      }),
    ]);
    if (organizer?.role !== UserRole.CLUB) {
      throw new NotFoundException("Réservé à l'organisateur du club");
    }
    if (!member) throw new NotFoundException("Membre non trouvé");

    const sameClub =
      organizer.clubId && member.clubId
        ? organizer.clubId === member.clubId
        : organizer.clubName?.trim() && member.clubName?.trim()
          ? organizer.clubName.trim().toLowerCase() ===
            member.clubName.trim().toLowerCase()
          : false;

    if (!sameClub) {
      throw new NotFoundException(
        "Vous ne pouvez inscrire que les membres de votre club",
      );
    }
  }
```

- [x] **Step 3 : Ajouter les tests dans `competition-registration.service.spec.ts`**

Ajouter ces describes à la fin du `describe("CompetitionRegistrationService", ...)` existant (avant le `}` fermant) :

```typescript
describe('registerMember', () => {
  it('throws NotFoundException when organizer has wrong role', async () => {
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ role: 'LICENSEE', clubId: 'club-1', clubName: null })
      .mockResolvedValueOnce({ clubId: 'club-1', clubName: null });

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when member not found', async () => {
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ role: UserRole.CLUB, clubId: 'club-1', clubName: null })
      .mockResolvedValueOnce(null);

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when member belongs to different club', async () => {
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ role: UserRole.CLUB, clubId: 'club-1', clubName: null })
      .mockResolvedValueOnce({ clubId: 'club-2', clubName: null });

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when event not found', async () => {
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ role: UserRole.CLUB, clubId: 'club-1', clubName: null })
      .mockResolvedValueOnce({ clubId: 'club-1', clubName: null });
    mockPrismaService.event.findUnique.mockResolvedValue(null);

    await expect(service.registerMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('unregisterMember', () => {
  it('throws NotFoundException when member not from organizer club', async () => {
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ role: UserRole.CLUB, clubId: 'club-1', clubName: null })
      .mockResolvedValueOnce({ clubId: 'club-2', clubName: null });

    await expect(service.unregisterMember('organizer-1', 'event-1', 'member-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('getPendingRegistrationsForClub', () => {
  it('returns empty array when organizer is not CLUB role', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      clubId: 'club-1',
      clubName: null,
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });

  it('returns empty array when organizer has no club', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: UserRole.CLUB,
      clubId: null,
      clubName: null,
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });

  it('returns pending registrations with competition info', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: UserRole.CLUB,
      clubId: 'club-1',
      clubName: null,
    });
    mockPrismaService.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        status: 'PENDING',
        user: {
          id: 'user-1',
          firstName: 'Alice',
          lastName: 'Martin',
          email: 'alice@example.com',
          clubName: null,
        },
        event: {
          id: 'event-1',
          category: 'Adultes',
          ageGroup: null,
          eventType: 'STANDARD',
          competitionId: 'comp-1',
        },
      },
    ]);
    mockPrismaService.competition.findMany.mockResolvedValue([
      { id: 'comp-1', title: 'Championnat 2026', date: new Date('2026-06-01') },
    ]);

    const result = await service.getPendingRegistrationsForClub('organizer-1');

    expect(result).toHaveLength(1);
    expect(result[0].competition).toEqual(
      expect.objectContaining({ id: 'comp-1', title: 'Championnat 2026' }),
    );
  });
});
```

- [x] **Step 4 : Lancer les tests du module competitions**

```bash
cd apps/backend && pnpm test --testPathPattern="competition-registration"
```

Attendu : tous les tests passent (anciens + nouveaux)

- [x] **Step 5 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/competitions/services/competition-registration.service.ts apps/backend/src/competitions/services/competition-registration.service.spec.ts && git commit -m "refactor(competitions): move organizer methods to CompetitionRegistrationService"
```

---

## Tâche 3 : Supprimer CompetitionsService

**Files:**

- Delete: `apps/backend/src/competitions/competitions.service.ts`
- Delete: `apps/backend/src/competitions/competitions.service.spec.ts`

### Contexte

`CompetitionsService` n'a aucun consommateur externe au module (vérifié par grep). Il sera retiré du module à la tâche 4. Il faut d'abord le supprimer pour éviter les imports fantômes.

- [x] **Step 1 : Supprimer les deux fichiers**

```bash
rm apps/backend/src/competitions/competitions.service.ts
rm apps/backend/src/competitions/competitions.service.spec.ts
```

- [x] **Step 2 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add -A apps/backend/src/competitions/competitions.service.ts apps/backend/src/competitions/competitions.service.spec.ts && git commit -m "refactor(competitions): delete CompetitionsService facade"
```

---

## Tâche 4 : Mettre à jour CompetitionsModule

**Files:**

- Modify: `apps/backend/src/competitions/competitions.module.ts`

- [x] **Step 1 : Réécrire `competitions.module.ts`**

```typescript
// apps/backend/src/competitions/competitions.module.ts
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from '../auth/constants';
import { ClubsModule } from '../clubs/clubs.module';
import { RedisModule } from '../redis/redis.module';
import { CompetitionsController } from './competitions.controller';
import { LiveGateway } from './live.gateway';
import { CompetitionCacheService } from './services/competition-cache.service';
import { CompetitionManagementService } from './services/competition-management.service';
import { CompetitionQueryService } from './services/competition-query.service';
import { CompetitionRegistrationService } from './services/competition-registration.service';
import { CompetitionResultsService } from './services/competition-results.service';
import { CompetitionSyncService } from './services/competition-sync.service';
import { SyncProcessor } from './sync.processor';

@Module({
  imports: [
    HttpModule,
    RedisModule,
    ClubsModule,
    JwtModule.register({ secret: jwtConstants.secret }),
    BullModule.registerQueue({
      name: 'ffd-sync',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    }),
  ],
  controllers: [CompetitionsController],
  providers: [
    CompetitionManagementService,
    CompetitionQueryService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    CompetitionCacheService,
    CompetitionSyncService,
    LiveGateway,
    SyncProcessor,
  ],
  exports: [
    CompetitionManagementService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    LiveGateway,
  ],
})
export class CompetitionsModule {}
```

- [x] **Step 2 : Vérifier le typecheck sur le module**

```bash
cd apps/backend && pnpm typecheck 2>&1 | grep -E "competitions" | head -20
```

Attendu : pas d'erreur sur les fichiers competitions (des erreurs dans le controller sont attendues — le controller pointe encore sur CompetitionsService)

- [x] **Step 3 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/competitions/competitions.module.ts && git commit -m "refactor(competitions): update CompetitionsModule to use 4 specialized services"
```

---

## Tâche 5 : Mettre à jour CompetitionsController

**Files:**

- Modify: `apps/backend/src/competitions/competitions.controller.ts`

### Contexte

Le controller injecte uniquement `CompetitionsService`. Mettre à jour le constructeur pour injecter les 4 sous-services, puis rediriger les 22 appels.

- [x] **Step 1 : Remplacer l'import `CompetitionsService` par les 4 sous-services**

En haut de `competitions.controller.ts`, remplacer :

```typescript
import { CompetitionsService } from './competitions.service';
```

par :

```typescript
import { CompetitionManagementService } from './services/competition-management.service';
import { CompetitionQueryService } from './services/competition-query.service';
import { CompetitionRegistrationService } from './services/competition-registration.service';
import { CompetitionResultsService } from './services/competition-results.service';
```

- [x] **Step 2 : Mettre à jour le constructeur**

Remplacer :

```typescript
constructor(private readonly competitionsService: CompetitionsService) {}
```

par :

```typescript
constructor(
  private readonly queryService: CompetitionQueryService,
  private readonly registrationService: CompetitionRegistrationService,
  private readonly resultsService: CompetitionResultsService,
  private readonly managementService: CompetitionManagementService,
) {}
```

- [x] **Step 3 : Rediriger les 22 appels selon ce tableau**

| Ligne ~approx | Appel actuel                                                                               | Remplacement                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 109           | `this.competitionsService.findAll(req.user.userId, pagination)`                            | `this.queryService.findAll(req.user.userId, pagination)`                                                                                |
| 148           | `this.competitionsService.findActiveCompetition()`                                         | `this.queryService.findActiveCompetition()`                                                                                             |
| 171           | `this.competitionsService.enqueueSyncFFD()`                                                | `this.managementService.enqueueSyncFFD()`                                                                                               |
| 188           | `this.competitionsService.getPendingRegistrationsForClub(req.user.userId)`                 | `this.registrationService.getPendingRegistrationsForClub(req.user.userId)`                                                              |
| 212-224       | `this.competitionsService.registerMember(...)`                                             | `this.registrationService.registerMember(...)` (mêmes arguments)                                                                        |
| 246-250       | `this.competitionsService.unregisterMember(...)`                                           | `this.registrationService.unregisterMember(...)` (mêmes arguments)                                                                      |
| 272-275       | `this.competitionsService.confirmRegistration(req.user.userId, registrationId)`            | `this.registrationService.confirmRegistration(registrationId, req.user.userId)` ⚠️ ordre inversé                                        |
| 297           | `this.competitionsService.getRegulationConstants()`                                        | `this.managementService.getRegulationConstants()`                                                                                       |
| 316           | `this.competitionsService.findOneForUser(id, req.user.userId)`                             | `this.queryService.findOneForUser(id, req.user.userId)`                                                                                 |
| 350           | `this.competitionsService.getSyncStatus()`                                                 | `this.managementService.getSyncStatus()`                                                                                                |
| 407           | `this.competitionsService.findOne(id)`                                                     | `this.queryService.findOne(id)`                                                                                                         |
| 505-516       | `this.competitionsService.register(req.user.userId, body.eventId, ...)`                    | `this.registrationService.register(body.eventId, req.user.userId, body.partnerName, { byOrganizer: false, ... })` ⚠️ ordre args inversé |
| 556           | `this.competitionsService.getResults(id)`                                                  | `this.resultsService.getResults(id)`                                                                                                    |
| 606           | `this.competitionsService.getEventRegistrations(eventId)`                                  | `this.resultsService.getEventRegistrations(eventId)`                                                                                    |
| 637           | `this.competitionsService.unregister(req.user.userId, body.eventId)`                       | `this.registrationService.unregister(body.eventId, req.user.userId, {})` ⚠️ ordre args inversé                                          |
| 676           | `this.competitionsService.getUserRegistrations(req.user.userId)`                           | `this.resultsService.getUserRegistrations(req.user.userId)`                                                                             |
| 705           | `this.competitionsService.checkIn(competitionId, body.qrData)`                             | `this.resultsService.checkIn(competitionId, body.qrData)`                                                                               |
| 727-730       | `this.competitionsService.generateVolunteerToken(competitionId, body.name)`                | `this.resultsService.generateVolunteerToken(competitionId, body.name)`                                                                  |
| 746-750       | `this.competitionsService.checkInAsVolunteer(body.competitionId, body.token, body.qrData)` | `this.resultsService.checkInAsVolunteer(body.competitionId, body.token, body.qrData)`                                                   |
| 760           | `this.competitionsService.create(body)`                                                    | `this.managementService.create(body)`                                                                                                   |
| 774           | `this.competitionsService.update(id, body)`                                                | `this.managementService.update(id, body)`                                                                                               |

**⚠️ Points d'attention — ordre des arguments inversé :**

1. `confirmRegistration` : `competitionsService.confirmRegistration(organizerUserId, registrationId)` → `registrationService.confirmRegistration(registrationId, organizerUserId)` (l'ordre dans `CompetitionRegistrationService` est `confirmRegistration(registrationId, organizerUserId)`)

2. `register` : `competitionsService.register(userId, eventId, partnerName, options)` → `registrationService.register(eventId, userId, partnerName, { byOrganizer: false, ...options })`

3. `unregister` : `competitionsService.unregister(userId, eventId)` → `registrationService.unregister(eventId, userId, {})`

- [x] **Step 4 : Lancer le typecheck complet**

```bash
cd apps/backend && pnpm typecheck 2>&1 | grep -v "^$" | head -30
```

Attendu : zéro erreur

- [x] **Step 5 : Lancer tous les tests**

```bash
cd apps/backend && pnpm test --silent 2>&1 | tail -8
```

Attendu :

```
Test Suites: 77 passed, 77 total
Tests:       ~985 passed, 0 failed
```

(+~20 nouveaux tests par rapport aux 965 de base)

- [x] **Step 6 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/competitions/competitions.controller.ts && git commit -m "refactor(competitions): update CompetitionsController to inject 4 specialized services"
```

---

## Self-review

**Couverture spec :**

- ✅ CompetitionManagementService créé (CRUD + sync + regulation) → Tâche 1
- ✅ Méthodes organisateur déplacées dans CompetitionRegistrationService → Tâche 2
- ✅ CompetitionsService supprimé → Tâche 3
- ✅ CompetitionsModule mis à jour → Tâche 4
- ✅ CompetitionsController mis à jour → Tâche 5

**Points critiques :**

- Ordre des arguments `register(eventId, userId, ...)` — `CompetitionRegistrationService` prend `eventId` en premier, `CompetitionsService` prenait `userId` en premier. Documenté en ⚠️ dans Tâche 5 Step 3.
- Ordre des arguments `confirmRegistration(registrationId, organizerUserId)` — documenté en ⚠️.
- `CompetitionManagementService` importe `COMPETITION_BASE_SELECT` depuis `competition-query.service` — export nommé existant.
