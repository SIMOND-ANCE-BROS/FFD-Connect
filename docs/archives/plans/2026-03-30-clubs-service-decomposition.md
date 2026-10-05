# Clubs Service Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Décomposer `clubs.service.ts` (981 lignes) en 4 services spécialisés sans modifier le comportement observable (endpoints, signatures, tests).

**Architecture:** On extrait 3 services de `ClubsService` : `SoloTeamService`, `PartnershipService`, `ClubsHelloAssoService`. `ClubsService` garde uniquement le core (getClubIdForOrganizer + findOrCreateByName). Les 3 nouveaux services injectent `ClubsService` pour appeler ces méthodes core. Le `ClubsController` et les consommateurs externes sont mis à jour en dernier.

**Tech Stack:** NestJS, Prisma, TypeScript strict, Jest + jest-mock-extended

---

## Fichiers touchés

- Create: `apps/backend/src/clubs/solo-team.service.ts`
- Create: `apps/backend/src/clubs/solo-team.service.spec.ts`
- Create: `apps/backend/src/clubs/partnership.service.ts`
- Create: `apps/backend/src/clubs/partnership.service.spec.ts`
- Create: `apps/backend/src/clubs/clubs-helloasso.service.ts`
- Create: `apps/backend/src/clubs/clubs-helloasso.service.spec.ts`
- Modify: `apps/backend/src/clubs/clubs.service.ts` (supprimer les méthodes extraites)
- Modify: `apps/backend/src/clubs/clubs.service.spec.ts` (garder uniquement les tests core)
- Modify: `apps/backend/src/clubs/clubs.module.ts`
- Modify: `apps/backend/src/clubs/clubs.controller.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/payment/payment.service.ts`

---

## Tâche 1 : Créer SoloTeamService

**Files:**

- Create: `apps/backend/src/clubs/solo-team.service.ts`
- Create: `apps/backend/src/clubs/solo-team.service.spec.ts`

### Contexte

`SoloTeamService` extrait les 6 méthodes solo team de `ClubsService`. Ces méthodes commencent toutes par `getClubIdForOrganizer` — elles injectent donc `ClubsService` pour l'appeler. La constante `LEVEL_ORDER` et la fonction `levelOrder` sont utilisées uniquement par `recalculateSoloTeamLevel` — elles restent dans ce fichier.

- [x] **Step 1 : Créer `solo-team.service.ts`**

```typescript
// apps/backend/src/clubs/solo-team.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { handlePrismaError } from '../utils/prisma-errors.util';
import type { CreateSoloTeamDto } from './dto/create-soloteam.dto';
import { ClubsService } from './clubs.service';

const LEVEL_ORDER = ['Débutant', 'Intermédiaire', 'Avancé', 'International'];

@Injectable()
export class SoloTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getSoloTeams(organizerUserId: string) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    return this.prisma.soloTeam.findMany({
      where: { clubId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createSoloTeam(organizerUserId: string, dto: CreateSoloTeamDto) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    try {
      return await this.prisma.soloTeam.create({
        data: { clubId, name: dto.name.trim(), level: dto.level },
      });
    } catch (err) {
      handlePrismaError(err, 'SoloTeam');
    }
  }

  async getSoloTeam(organizerUserId: string, teamId: string) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
                birthDate: true,
              },
            },
          },
        },
      },
    });
    if (!team) throw new NotFoundException('Solo team not found');
    return team;
  }

  async addSoloTeamMember(organizerUserId: string, teamId: string, userId: string) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
    });
    if (!team) throw new NotFoundException('Solo team not found');
    const [user, club] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { clubId: true, clubName: true },
      }),
      this.prisma.club.findUnique({
        where: { id: clubId },
        select: { name: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!club) throw new NotFoundException('Club not found');
    const belongs =
      user.clubId === clubId || user.clubName?.trim().toLowerCase() === club.name.toLowerCase();
    if (!belongs) throw new BadRequestException('User must be a member of your club');
    try {
      await this.prisma.soloTeamMember.create({ data: { teamId, userId } });
    } catch (err) {
      handlePrismaError(err, 'SoloTeamMember');
    }
    return this.recalculateSoloTeamLevel(teamId);
  }

  async removeSoloTeamMember(organizerUserId: string, teamId: string, userId: string) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const team = await this.prisma.soloTeam.findFirst({
      where: { id: teamId, clubId },
    });
    if (!team) throw new NotFoundException('Solo team not found');
    await this.prisma.soloTeamMember.deleteMany({ where: { teamId, userId } });
    return this.recalculateSoloTeamLevel(teamId);
  }

  async recalculateSoloTeamLevel(teamId: string) {
    const members = await this.prisma.soloTeamMember.findMany({
      where: { teamId },
      include: { user: { select: { competitionLevel: true } } },
    });
    const levels = members.map((m) => m.user.competitionLevel?.trim()).filter(Boolean);
    const level = levels.some((l) => ['Intermédiaire', 'Avancé', 'International'].includes(l!))
      ? 'Intermédiaire'
      : 'Débutant';
    return this.prisma.soloTeam.update({
      where: { id: teamId },
      data: { level },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                competitionLevel: true,
              },
            },
          },
        },
      },
    });
  }
}
```

- [x] **Step 2 : Créer `solo-team.service.spec.ts`**

```typescript
// apps/backend/src/clubs/solo-team.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import { SoloTeamService } from './solo-team.service';

type MockPrisma = DeepMockProxy<PrismaClient>;

describe('SoloTeamService', () => {
  let service: SoloTeamService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<Pick<ClubsService, 'getClubIdForOrganizer'>>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = { getClubIdForOrganizer: jest.fn().mockResolvedValue('club-1') };

    const module = await Test.createTestingModule({
      providers: [
        SoloTeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
      ],
    }).compile();

    service = module.get<SoloTeamService>(SoloTeamService);
  });

  describe('getSoloTeams', () => {
    it("returns solo teams for the organizer's club", async () => {
      prisma.soloTeam.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Équipe A', clubId: 'club-1', level: 'Débutant', members: [] } as any,
      ]);

      const result = await service.getSoloTeams('organizer-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('team-1');
    });
  });

  describe('createSoloTeam', () => {
    it('creates and returns a new solo team', async () => {
      prisma.soloTeam.create.mockResolvedValue({
        id: 'team-1',
        name: 'Équipe A',
        clubId: 'club-1',
        level: 'Débutant',
      } as any);

      const result = await service.createSoloTeam('organizer-1', {
        name: 'Équipe A',
        level: 'Débutant',
      } as any);
      expect((result as any).id).toBe('team-1');
    });
  });

  describe('addSoloTeamMember', () => {
    it('throws NotFoundException when solo team not found', async () => {
      prisma.soloTeam.findFirst.mockResolvedValue(null);
      await expect(service.addSoloTeamMember('organizer-1', 'team-999', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when user is not a member of the club', async () => {
      prisma.soloTeam.findFirst.mockResolvedValue({ id: 'team-1', clubId: 'club-1' } as any);
      prisma.user.findUnique.mockResolvedValue({ clubId: 'other-club', clubName: null } as any);
      prisma.club.findUnique.mockResolvedValue({ name: 'Test Club' } as any);
      await expect(service.addSoloTeamMember('organizer-1', 'team-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('removeSoloTeamMember', () => {
    it('throws NotFoundException when solo team not found', async () => {
      prisma.soloTeam.findFirst.mockResolvedValue(null);
      await expect(
        service.removeSoloTeamMember('organizer-1', 'team-999', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes member and recalculates level', async () => {
      prisma.soloTeam.findFirst.mockResolvedValue({ id: 'team-1', clubId: 'club-1' } as any);
      prisma.soloTeamMember.deleteMany.mockResolvedValue({ count: 1 });
      prisma.soloTeamMember.findMany.mockResolvedValue([]);
      prisma.soloTeam.update.mockResolvedValue({
        id: 'team-1',
        level: 'Débutant',
        members: [],
      } as any);

      const result = await service.removeSoloTeamMember('organizer-1', 'team-1', 'user-1');
      expect((result as any).level).toBe('Débutant');
    });
  });

  describe('recalculateSoloTeamLevel', () => {
    it('sets level to Débutant when all members are Débutant', async () => {
      prisma.soloTeamMember.findMany.mockResolvedValue([
        { user: { competitionLevel: 'Débutant' } } as any,
      ]);
      prisma.soloTeam.update.mockResolvedValue({
        id: 'team-1',
        level: 'Débutant',
        members: [],
      } as any);

      const result = await service.recalculateSoloTeamLevel('team-1');
      expect(prisma.soloTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { level: 'Débutant' } }),
      );
    });

    it('sets level to Intermédiaire when at least one member is Intermédiaire', async () => {
      prisma.soloTeamMember.findMany.mockResolvedValue([
        { user: { competitionLevel: 'Débutant' } } as any,
        { user: { competitionLevel: 'Intermédiaire' } } as any,
      ]);
      prisma.soloTeam.update.mockResolvedValue({
        id: 'team-1',
        level: 'Intermédiaire',
        members: [],
      } as any);

      await service.recalculateSoloTeamLevel('team-1');
      expect(prisma.soloTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { level: 'Intermédiaire' } }),
      );
    });
  });
});
```

- [x] **Step 3 : Lancer les tests**

```bash
cd apps/backend && pnpm test solo-team.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 4 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/solo-team.service.ts apps/backend/src/clubs/solo-team.service.spec.ts && git commit -m "refactor(clubs): extract SoloTeamService"
```

---

## Tâche 2 : Créer PartnershipService

**Files:**

- Create: `apps/backend/src/clubs/partnership.service.ts`
- Create: `apps/backend/src/clubs/partnership.service.spec.ts`

### Contexte

`PartnershipService` extrait les 6 méthodes partnership + la méthode privée `notifyClubOrganizersForClub`. Ces méthodes dépendent de `PrismaService`, `ClubsService` (pour `getClubIdForOrganizer` + `findOrCreateByName`), et `NotificationsService`. Les imports `computeCoupleAgeGroup`, `getReferenceYear`, `getAllowedLevelsForCouple` migrent dans ce fichier.

- [x] **Step 1 : Créer `partnership.service.ts`**

Copier depuis `clubs.service.ts` les méthodes : `getPartnerships`, `createPartnership`, `endPartnership`, `validatePartnership`, `getClubsForPartnership`, `getMembersForPartnership`, `notifyClubOrganizersForClub` (privée).

```typescript
// apps/backend/src/clubs/partnership.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnershipManagementMode, PartnershipStatus, UserRole } from '@prisma/client';
import {
  computeCoupleAgeGroup,
  getReferenceYear,
  type CompetitionLevel,
} from '../common/age-group/age-group.util';
import { getAllowedLevelsForCouple } from '../common/level-accession/level-accession.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import type { CreatePartnershipDto } from './dto/create-partnership.dto';
import type { EndPartnershipDto } from './dto/end-partnership.dto';

@Injectable()
export class PartnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Coller ici les méthodes exactes de clubs.service.ts :
  // getPartnerships, createPartnership, endPartnership,
  // validatePartnership, getClubsForPartnership, getMembersForPartnership
  // En remplaçant this.getClubIdForOrganizer → this.clubsService.getClubIdForOrganizer
  // Et this.findOrCreateByName → this.clubsService.findOrCreateByName
  // La méthode privée notifyClubOrganizersForClub reste privée ici
}
```

**Note importante :** Copier le code exact des méthodes depuis `clubs.service.ts` (lignes 282-836). Remplacer uniquement :

- `this.getClubIdForOrganizer(` → `this.clubsService.getClubIdForOrganizer(`
- `this.findOrCreateByName(` → `this.clubsService.findOrCreateByName(`

Ne pas modifier la logique.

- [x] **Step 2 : Créer `partnership.service.spec.ts`**

Copier le setup et les describes `getPartnerships`, `createPartnership`, `endPartnership`, `validatePartnership` depuis `clubs.service.spec.ts`. Adapter :

- `ClubsService` → `PartnershipService` (le service sous test)
- Ajouter `ClubsService` comme dépendance mockée avec `getClubIdForOrganizer: jest.fn().mockResolvedValue("club-1")` et `findOrCreateByName: jest.fn()`

```typescript
// apps/backend/src/clubs/partnership.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ClubRegistrationMode,
  PartnershipManagementMode,
  PartnershipStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import { PartnershipService } from './partnership.service';

type MockPrisma = DeepMockProxy<PrismaClient>;

const mockNotifications = {
  createForUser: jest.fn().mockResolvedValue(undefined),
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  role: UserRole.CLUB,
  clubId: 'club-1',
  clubName: null,
  firstName: 'Alice',
  lastName: 'Martin',
  birthDate: new Date('1990-01-01'),
  ageGroup: null,
  category: null,
  competitionLevel: null,
  passportLevelLatin: null,
  passportLevelStandard: null,
  email: 'alice@example.com',
  ...overrides,
});

const makeClub = (overrides: Record<string, unknown> = {}) => ({
  id: 'club-1',
  name: 'Test Club',
  helloAssoClientId: null,
  helloAssoClientSecret: null,
  helloAssoOrgSlug: null,
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  ...overrides,
});

const makePartnership = (overrides: Record<string, unknown> = {}) => ({
  id: 'partnership-1',
  clubId: 'club-1',
  secondaryClubId: null,
  user1Id: 'user-a',
  user2Id: 'user-b',
  startDate: new Date('2024-01-01'),
  endDate: null,
  status: PartnershipStatus.ACTIVE,
  managementMode: PartnershipManagementMode.PRIMARY_ONLY,
  club: { id: 'club-1', name: 'Test Club' },
  secondaryClub: null,
  user1: { id: 'user-a', firstName: 'Alice', lastName: 'Martin' },
  user2: { id: 'user-b', firstName: 'Bob', lastName: 'Dupont' },
  ...overrides,
});

describe('PartnershipService', () => {
  let service: PartnershipService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<Pick<ClubsService, 'getClubIdForOrganizer' | 'findOrCreateByName'>>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = {
      getClubIdForOrganizer: jest.fn().mockResolvedValue('club-1'),
      findOrCreateByName: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PartnershipService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PartnershipService>(PartnershipService);
    jest.clearAllMocks();
    mockNotifications.createForUser.mockResolvedValue(undefined);
    clubsService.getClubIdForOrganizer.mockResolvedValue('club-1');
  });

  // Coller ici les describes getPartnerships, createPartnership,
  // endPartnership, validatePartnership, getClubsForPartnership, getMembersForPartnership
  // depuis clubs.service.spec.ts — en changeant "service" pour appeler PartnershipService
  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

**Note :** Copier les blocs `describe` complets depuis `clubs.service.spec.ts` pour `getPartnerships`, `createPartnership`, `endPartnership`, `validatePartnership`. Les tests `createSoloTeam`, `addSoloTeamMember`, `recalculateSoloTeamLevel` appartiennent à `SoloTeamService` (déjà dans Tâche 1).

- [x] **Step 3 : Lancer les tests**

```bash
cd apps/backend && pnpm test partnership.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 4 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/partnership.service.ts apps/backend/src/clubs/partnership.service.spec.ts && git commit -m "refactor(clubs): extract PartnershipService"
```

---

## Tâche 3 : Créer ClubsHelloAssoService

**Files:**

- Create: `apps/backend/src/clubs/clubs-helloasso.service.ts`
- Create: `apps/backend/src/clubs/clubs-helloasso.service.spec.ts`

### Contexte

`ClubsHelloAssoService` extrait les 5 méthodes HelloAsso + registration mode. Ces méthodes dépendent de `PrismaService` et `ClubsService` (pour `getClubIdForOrganizer` et `findOrCreateByName`).

- [x] **Step 1 : Créer `clubs-helloasso.service.ts`**

Copier depuis `clubs.service.ts` les méthodes : `getMyClubHelloAssoStatus`, `getRegistrationModeForUser`, `setRegistrationMode`, `connectHelloAsso`, `getHelloAssoCredentialsForCompetition` (lignes 90-280).

```typescript
// apps/backend/src/clubs/clubs-helloasso.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClubRegistrationMode, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import type { ConnectHelloAssoDto } from './dto/connect-helloasso.dto';

@Injectable()
export class ClubsHelloAssoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  // Coller ici les méthodes exactes depuis clubs.service.ts :
  // getMyClubHelloAssoStatus, getRegistrationModeForUser, setRegistrationMode,
  // connectHelloAsso, getHelloAssoCredentialsForCompetition
  // En remplaçant this.getClubIdForOrganizer → this.clubsService.getClubIdForOrganizer
  // Et this.findOrCreateByName → this.clubsService.findOrCreateByName
}
```

- [x] **Step 2 : Créer `clubs-helloasso.service.spec.ts`**

```typescript
// apps/backend/src/clubs/clubs-helloasso.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClubRegistrationMode, PrismaClient, UserRole } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import { ClubsHelloAssoService } from './clubs-helloasso.service';

type MockPrisma = DeepMockProxy<PrismaClient>;

describe('ClubsHelloAssoService', () => {
  let service: ClubsHelloAssoService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<Pick<ClubsService, 'getClubIdForOrganizer' | 'findOrCreateByName'>>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = {
      getClubIdForOrganizer: jest.fn().mockResolvedValue('club-1'),
      findOrCreateByName: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ClubsHelloAssoService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
      ],
    }).compile();

    service = module.get<ClubsHelloAssoService>(ClubsHelloAssoService);
    jest.clearAllMocks();
    clubsService.getClubIdForOrganizer.mockResolvedValue('club-1');
  });

  // Copier ici les describes getMyClubHelloAssoStatus, getRegistrationModeForUser,
  // setRegistrationMode, connectHelloAsso depuis clubs.service.spec.ts
  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

**Note :** Copier les blocs `describe` complets pour `getMyClubHelloAssoStatus`, `getRegistrationModeForUser`, `connectHelloAsso`, `setRegistrationMode` depuis `clubs.service.spec.ts`.

- [x] **Step 3 : Lancer les tests**

```bash
cd apps/backend && pnpm test clubs-helloasso.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 4 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/clubs-helloasso.service.ts apps/backend/src/clubs/clubs-helloasso.service.spec.ts && git commit -m "refactor(clubs): extract ClubsHelloAssoService"
```

---

## Tâche 4 : Slim down ClubsService

**Files:**

- Modify: `apps/backend/src/clubs/clubs.service.ts`
- Modify: `apps/backend/src/clubs/clubs.service.spec.ts`

### Contexte

Maintenant que les 3 sous-services existent, on supprime leurs méthodes de `ClubsService`. Il ne reste que `getClubIdForOrganizer` et `findOrCreateByName`. On supprime aussi les imports devenus inutilisés.

- [x] **Step 1 : Réécrire `clubs.service.ts`**

```typescript
// apps/backend/src/clubs/clubs.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from './../prisma/prisma.service';

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retourne l'ID du club de l'organisateur (CLUB role). Lance si pas de club.
   */
  async getClubIdForOrganizer(organizerUserId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CLUB) {
      throw new BadRequestException('Only club role can manage club data');
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : user.clubName?.trim()
        ? await this.findOrCreateByName(user.clubName)
        : null;
    if (!club) {
      throw new BadRequestException(
        'Organizer has no club assigned. Set clubName on your profile first.',
      );
    }
    return club.id;
  }

  /**
   * Récupère ou crée le club par son nom (insensible à la casse pour le lookup).
   */
  async findOrCreateByName(name: string) {
    const normalized = name.trim();
    if (!normalized) {
      throw new BadRequestException('Club name is required');
    }
    let club = await this.prisma.club.findFirst({
      where: { name: { equals: normalized, mode: 'insensitive' } },
    });
    club ??= await this.prisma.club.create({
      data: { name: normalized },
    });
    return club;
  }
}
```

- [x] **Step 2 : Mettre à jour `clubs.service.spec.ts`**

Garder uniquement les describes `getClubIdForOrganizer` et `findOrCreateByName`. Supprimer les autres describes (ils sont maintenant dans leurs propres spec files). Supprimer `NotificationsService` du setup.

```typescript
// apps/backend/src/clubs/clubs.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';

type MockPrisma = DeepMockProxy<PrismaClient>;

describe('ClubsService', () => {
  let service: ClubsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    const module = await Test.createTestingModule({
      providers: [ClubsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ClubsService>(ClubsService);
    jest.clearAllMocks();
  });

  describe('getClubIdForOrganizer', () => {
    it('throws NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getClubIdForOrganizer('unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user role is not CLUB', async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.LICENSEE,
        clubId: null,
        clubName: null,
      } as any);
      await expect(service.getClubIdForOrganizer('user-1')).rejects.toThrow(BadRequestException);
    });

    it('returns clubId when user has a clubId and club exists', async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: 'club-1',
        clubName: null,
      } as any);
      prisma.club.findUnique.mockResolvedValue({ id: 'club-1', name: 'Test Club' } as any);
      const result = await service.getClubIdForOrganizer('user-1');
      expect(result).toBe('club-1');
    });

    it('throws BadRequestException when user has neither clubId nor clubName', async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: null,
        clubName: null,
      } as any);
      await expect(service.getClubIdForOrganizer('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOrCreateByName', () => {
    it('throws BadRequestException for empty name', async () => {
      await expect(service.findOrCreateByName('')).rejects.toThrow(BadRequestException);
    });

    it('returns existing club when found by name', async () => {
      prisma.club.findFirst.mockResolvedValue({ id: 'club-1', name: 'Test Club' } as any);
      const result = await service.findOrCreateByName('Test Club');
      expect(result.id).toBe('club-1');
    });

    it('creates and returns a new club when not found', async () => {
      prisma.club.findFirst.mockResolvedValue(null);
      prisma.club.create.mockResolvedValue({ id: 'club-2', name: 'New Club' } as any);
      const result = await service.findOrCreateByName('New Club');
      expect(result.id).toBe('club-2');
    });
  });
});
```

- [x] **Step 3 : Lancer les tests du module clubs**

```bash
cd apps/backend && pnpm test --testPathPattern="clubs"
```

Attendu : tous les tests passent (clubs.service, partnership, solo-team, clubs-helloasso)

- [x] **Step 4 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/clubs.service.ts apps/backend/src/clubs/clubs.service.spec.ts && git commit -m "refactor(clubs): slim down ClubsService to core only"
```

---

## Tâche 5 : Mettre à jour ClubsModule

**Files:**

- Modify: `apps/backend/src/clubs/clubs.module.ts`

- [x] **Step 1 : Mettre à jour le module**

```typescript
// apps/backend/src/clubs/clubs.module.ts
import { Module } from '@nestjs/common';
import { ClubsController } from './clubs.controller';
import { ClubsHelloAssoService } from './clubs-helloasso.service';
import { ClubsService } from './clubs.service';
import { PartnershipService } from './partnership.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SoloTeamService } from './solo-team.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClubsController],
  providers: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
  exports: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
})
export class ClubsModule {}
```

**Note :** `NotificationsService` est fourni globalement via `NotificationsModule` dans `app.module.ts` — pas besoin de l'importer ici.

- [x] **Step 2 : Vérifier que le module compile**

```bash
cd apps/backend && pnpm typecheck 2>&1 | grep -E "clubs" | head -10
```

Attendu : pas d'erreur de type sur les fichiers clubs

- [x] **Step 3 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/clubs.module.ts && git commit -m "refactor(clubs): update ClubsModule to declare all 4 services"
```

---

## Tâche 6 : Mettre à jour ClubsController

**Files:**

- Modify: `apps/backend/src/clubs/clubs.controller.ts`

### Contexte

Le controller injecte actuellement uniquement `ClubsService`. Chaque méthode du controller doit maintenant appeler le bon service. La liste des appels à rediriger :

| Méthode controller           | Service cible           |
| ---------------------------- | ----------------------- |
| `getRegistrationModeForUser` | `ClubsHelloAssoService` |
| `getMyClubHelloAssoStatus`   | `ClubsHelloAssoService` |
| `connectHelloAsso`           | `ClubsHelloAssoService` |
| `setRegistrationMode`        | `ClubsHelloAssoService` |
| `getPartnerships`            | `PartnershipService`    |
| `createPartnership`          | `PartnershipService`    |
| `endPartnership`             | `PartnershipService`    |
| `validatePartnership`        | `PartnershipService`    |
| `getClubsForPartnership`     | `PartnershipService`    |
| `getMembersForPartnership`   | `PartnershipService`    |
| `getSoloTeams`               | `SoloTeamService`       |
| `createSoloTeam`             | `SoloTeamService`       |
| `getSoloTeam`                | `SoloTeamService`       |
| `addSoloTeamMember`          | `SoloTeamService`       |
| `removeSoloTeamMember`       | `SoloTeamService`       |

- [x] **Step 1 : Mettre à jour les imports du controller**

En haut de `clubs.controller.ts`, remplacer l'import `ClubsService` par les 4 services :

```typescript
import { ClubsHelloAssoService } from './clubs-helloasso.service';
import { ClubsService } from './clubs.service';
import { PartnershipService } from './partnership.service';
import { SoloTeamService } from './solo-team.service';
```

- [x] **Step 2 : Mettre à jour le constructeur**

```typescript
constructor(
  private readonly clubsService: ClubsService,
  private readonly clubsHelloAssoService: ClubsHelloAssoService,
  private readonly partnershipService: PartnershipService,
  private readonly soloTeamService: SoloTeamService,
) {}
```

- [x] **Step 3 : Mettre à jour les appels dans chaque méthode**

Remplacer `this.clubsService.X(` par le bon service selon le tableau ci-dessus. Par exemple :

```typescript
// Avant
return this.clubsService.getMyClubHelloAssoStatus(req.user.userId);

// Après
return this.clubsHelloAssoService.getMyClubHelloAssoStatus(req.user.userId);
```

Faire de même pour chaque méthode dans le controller (il y en a ~15).

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/backend && pnpm test --testPathPattern="clubs"
```

Attendu : tous les tests passent

- [x] **Step 5 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/clubs/clubs.controller.ts && git commit -m "refactor(clubs): update ClubsController to inject 4 specialized services"
```

---

## Tâche 7 : Mettre à jour les consommateurs externes

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/payment/payment.service.ts`

### Contexte

Deux services hors du module clubs dépendent de `ClubsService` pour des méthodes qui ont été déplacées vers `ClubsHelloAssoService` :

- `CompetitionRegistrationService` → `getRegistrationModeForUser` → désormais dans `ClubsHelloAssoService`
- `PaymentService` → `getHelloAssoCredentialsForCompetition` → désormais dans `ClubsHelloAssoService`

- [x] **Step 1 : Mettre à jour `competition-registration.service.ts`**

Remplacer l'import et l'injection de `ClubsService` par `ClubsHelloAssoService` :

```typescript
// Avant
import { ClubsService } from "../../clubs/clubs.service";
// ...
private readonly clubsService: ClubsService,
// ...
const mode = await this.clubsService.getRegistrationModeForUser(userId);

// Après
import { ClubsHelloAssoService } from "../../clubs/clubs-helloasso.service";
// ...
private readonly clubsHelloAssoService: ClubsHelloAssoService,
// ...
const mode = await this.clubsHelloAssoService.getRegistrationModeForUser(userId);
```

- [x] **Step 2 : Mettre à jour `payment.service.ts`**

```typescript
// Avant
import { ClubsService } from "../clubs/clubs.service";
// ...
private readonly clubsService: ClubsService,
// ...
await this.clubsService.getHelloAssoCredentialsForCompetition(competitionId)

// Après
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
// ...
private readonly clubsHelloAssoService: ClubsHelloAssoService,
// ...
await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(competitionId)
```

- [x] **Step 3 : Mettre à jour les specs de ces deux services**

Dans `competition-registration.service.spec.ts` : remplacer `ClubsService` par `ClubsHelloAssoService` dans les providers du module de test et dans les mocks.

Dans `payment.service.spec.ts` : même chose.

- [x] **Step 4 : Lancer tous les tests**

```bash
cd apps/backend && pnpm test --silent 2>&1 | tail -8
```

Attendu :

```
Test Suites: 76 passed, 76 total
Tests:       ~990 passed, 0 failed
```

- [x] **Step 5 : Vérifier le typecheck complet**

```bash
cd apps/backend && pnpm typecheck 2>&1 | grep -v "^$" | head -20
```

Attendu : pas d'erreur

- [x] **Step 6 : Commit**

```bash
cd /Users/gabin/Development/FFD-Connect && git add apps/backend/src/competitions/services/competition-registration.service.ts apps/backend/src/competitions/services/competition-registration.service.spec.ts apps/backend/src/payment/payment.service.ts apps/backend/src/payment/payment.service.spec.ts && git commit -m "refactor(clubs): update external consumers to use ClubsHelloAssoService"
```

---

## Self-review

**Couverture spec :**

- ✅ SoloTeamService extrait → Tâche 1
- ✅ PartnershipService extrait → Tâche 2
- ✅ ClubsHelloAssoService extrait → Tâche 3
- ✅ ClubsService slimmé → Tâche 4
- ✅ ClubsModule mis à jour → Tâche 5
- ✅ ClubsController mis à jour → Tâche 6
- ✅ Consommateurs externes mis à jour → Tâche 7

**Placeholders :** Les Tâches 2 et 3 demandent de "coller ici les méthodes depuis clubs.service.ts" — c'est intentionnel (le code source existe et est précis). L'implémenteur lit `clubs.service.ts` et copie les méthodes identifiées par leurs lignes.

**Cohérence types :**

- `ClubsHelloAssoService` dans les tâches 3, 5, 6, 7 — nom cohérent
- `PartnershipService` dans les tâches 2, 5, 6 — cohérent
- `SoloTeamService` dans les tâches 1, 5, 6 — cohérent
