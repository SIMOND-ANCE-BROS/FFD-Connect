# Partnership Service Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Décomposer `PartnershipService` (604 lignes) en 2 services spécialisés + 1 util pur, sans modifier le controller.

**Architecture:** `PartnershipService` garde le cycle de vie (create/end/validate) et appelle un nouvel util `computePartnershipSuggestion` au lieu de la logique inline. `PartnershipQueryService` prend les 3 méthodes de lecture. `ClubsController` continue d'injecter uniquement `PartnershipService`.

**Tech Stack:** NestJS, Prisma, Jest avec jest-mock-extended (mockDeep).

---

## Files

- Create: `apps/backend/src/clubs/partnership-suggestion.util.ts`
- Create: `apps/backend/src/clubs/partnership-suggestion.util.spec.ts`
- Create: `apps/backend/src/clubs/partnership-query.service.ts`
- Create: `apps/backend/src/clubs/partnership-query.service.spec.ts`
- Modify: `apps/backend/src/clubs/partnership.service.ts`
- Modify: `apps/backend/src/clubs/partnership.service.spec.ts`
- Modify: `apps/backend/src/clubs/clubs.module.ts`

---

### Task 1: Créer partnership-suggestion.util.ts avec spec

**Files:**

- Create: `apps/backend/src/clubs/partnership-suggestion.util.ts`
- Create: `apps/backend/src/clubs/partnership-suggestion.util.spec.ts`

- [x] **Step 1: Écrire le test qui échoue**

Créer `apps/backend/src/clubs/partnership-suggestion.util.spec.ts` :

```typescript
import { computePartnershipSuggestion } from './partnership-suggestion.util';

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  birthDate: new Date('1995-06-15'),
  passportLevelLatin: null as string | null,
  passportLevelStandard: null as string | null,
  category: null as string | null,
  competitionLevel: null as string | null,
  ...overrides,
});

describe('computePartnershipSuggestion', () => {
  const startDate = new Date('2024-01-01');

  it('returns null suggestedLevel and default categories when no passport levels', () => {
    const u1 = makeUser();
    const u2 = makeUser();
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedLevel).toBeNull();
    expect(result.suggestedCategories).toEqual(expect.arrayContaining(['Latine', 'Standard']));
  });

  it('infers Latine category from category field', () => {
    const u1 = makeUser({ category: 'Latine' });
    const u2 = makeUser({ category: 'Latine' });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain('Latine');
    expect(result.suggestedCategories).not.toContain('Standard');
  });

  it('infers Standard category from category field', () => {
    const u1 = makeUser({ category: 'Standard' });
    const u2 = makeUser({ category: 'Standard' });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain('Standard');
    expect(result.suggestedCategories).not.toContain('Latine');
  });

  it('returns both categories when one user has Latin and the other Standard', () => {
    const u1 = makeUser({ category: 'Latine' });
    const u2 = makeUser({ category: 'Standard' });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain('Latine');
    expect(result.suggestedCategories).toContain('Standard');
  });

  it("infers 10 danses from category containing '10'", () => {
    const u1 = makeUser({ category: '10 danses' });
    const u2 = makeUser({ category: '10 danses' });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain('10 danses');
  });

  it('returns coupleAgeGroup when both users have birthDates', () => {
    const u1 = makeUser({ birthDate: new Date('1995-01-01') });
    const u2 = makeUser({ birthDate: new Date('1993-01-01') });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.coupleAgeGroup).not.toBeNull();
  });

  it('returns null coupleAgeGroup when a user has no birthDate', () => {
    const u1 = makeUser({ birthDate: null });
    const u2 = makeUser();
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.coupleAgeGroup).toBeNull();
  });
});
```

- [x] **Step 2: Vérifier que le test échoue**

```bash
cd apps/backend && npx jest partnership-suggestion.util.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './partnership-suggestion.util'`

- [x] **Step 3: Créer l'implémentation**

Créer `apps/backend/src/clubs/partnership-suggestion.util.ts` :

```typescript
import {
  computeCoupleAgeGroup,
  getReferenceYear,
  type CompetitionLevel,
} from '../common/age-group/age-group.util';
import { getAllowedLevelsForCouple } from '../common/level-accession/level-accession.util';

export const LEVEL_ORDER: CompetitionLevel[] = [
  'Débutant',
  'Intermédiaire',
  'Avancé',
  'International',
];

export function levelOrder(l: string | null | undefined): number {
  const i = LEVEL_ORDER.indexOf(l as CompetitionLevel);
  return i >= 0 ? i : 999;
}

export interface PartnershipUserInput {
  birthDate: Date | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  category: string | null;
  competitionLevel: string | null;
}

export interface PartnershipSuggestion {
  coupleAgeGroup: string | null;
  suggestedLevel: CompetitionLevel | null;
  suggestedCategories: string[];
}

export function computePartnershipSuggestion(
  u1: PartnershipUserInput,
  u2: PartnershipUserInput,
  startDate: Date,
): PartnershipSuggestion {
  const refYear = getReferenceYear(startDate);
  const b1 = u1.birthDate ? new Date(u1.birthDate) : null;
  const b2 = u2.birthDate ? new Date(u2.birthDate) : null;
  const [birthOlder, birthYounger] =
    b1 && b2 ? (b1.getTime() <= b2.getTime() ? [b2, b1] : [b1, b2]) : [null, null];
  const coupleAgeGroup =
    birthOlder !== null ? computeCoupleAgeGroup(birthOlder, birthYounger, refYear) : null;

  const allowedLevels = getAllowedLevelsForCouple(
    coupleAgeGroup,
    {
      passportLevelLatin: u1.passportLevelLatin,
      passportLevelStandard: u1.passportLevelStandard,
    },
    {
      passportLevelLatin: u2.passportLevelLatin,
      passportLevelStandard: u2.passportLevelStandard,
    },
  );

  const l1 = (u1.competitionLevel?.trim() ?? '') as CompetitionLevel;
  const l2 = (u2.competitionLevel?.trim() ?? '') as CompetitionLevel;
  const o1 = levelOrder(l1);
  const o2 = levelOrder(l2);
  const minPartnerOrder = o1 < 999 && o2 < 999 ? Math.min(o1, o2) : 0;
  const possibleLevels = allowedLevels.filter((l) => levelOrder(l) <= minPartnerOrder);
  const suggestedLevel =
    allowedLevels.length > 0
      ? possibleLevels.length > 0
        ? possibleLevels.reduce((a, b) => (levelOrder(a) >= levelOrder(b) ? a : b))
        : allowedLevels[allowedLevels.length - 1]
      : null;

  const cats = new Set<string>();
  for (const c of [u1.category, u2.category].filter(Boolean) as string[]) {
    const n = c.trim().toLowerCase();
    if (n.includes('latin')) cats.add('Latine');
    if (n.includes('standard')) cats.add('Standard');
    if (n.includes('10') || n.includes('ten')) cats.add('10 danses');
  }
  if (cats.size === 0) {
    cats.add('Latine');
    cats.add('Standard');
  }

  return {
    coupleAgeGroup,
    suggestedLevel: suggestedLevel ?? null,
    suggestedCategories: Array.from(cats),
  };
}
```

- [x] **Step 4: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest partnership-suggestion.util.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 7 tests

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/clubs/partnership-suggestion.util.ts src/clubs/partnership-suggestion.util.spec.ts
git commit -m "feat(clubs): extract computePartnershipSuggestion pure util"
```

---

### Task 2: Créer PartnershipQueryService avec spec

**Files:**

- Create: `apps/backend/src/clubs/partnership-query.service.ts`
- Create: `apps/backend/src/clubs/partnership-query.service.spec.ts`

- [x] **Step 1: Écrire le test qui échoue**

Créer `apps/backend/src/clubs/partnership-query.service.spec.ts` :

```typescript
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ClubRegistrationMode,
  PartnershipManagementMode,
  PartnershipStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import { PartnershipQueryService } from './partnership-query.service';

type MockPrisma = DeepMockProxy<PrismaClient>;

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

describe('PartnershipQueryService', () => {
  let service: PartnershipQueryService;
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
        PartnershipQueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
      ],
    }).compile();

    service = module.get<PartnershipQueryService>(PartnershipQueryService);
    jest.clearAllMocks();
    clubsService.getClubIdForOrganizer.mockResolvedValue('club-1');
  });

  describe('getPartnerships', () => {
    it('returns partnerships with activeOnly=true by default', async () => {
      prisma.partnership.findMany.mockResolvedValue([makePartnership()] as never);
      const result = await service.getPartnerships('organizer-1');
      expect(result.partnerships).toHaveLength(1);
      expect(result.myClubId).toBe('club-1');
    });

    it('returns all partnerships including ended when activeOnly=false', async () => {
      prisma.partnership.findMany.mockResolvedValue([makePartnership()] as never);
      const result = await service.getPartnerships('organizer-1', false);
      expect(result.partnerships).toHaveLength(1);
    });
  });

  describe('getClubsForPartnership', () => {
    it("returns clubs excluding the organizer's own club", async () => {
      const clubs = [{ id: 'club-2', name: 'Other Club' }];
      prisma.club.findMany.mockResolvedValue(clubs as never);
      const result = await service.getClubsForPartnership('organizer-1');
      expect(result).toEqual(clubs);
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { not: 'club-1' } } }),
      );
    });
  });

  describe('getMembersForPartnership', () => {
    it('throws BadRequestException when user is not CLUB role', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ role: UserRole.LICENSEE }) as never);
      await expect(service.getMembersForPartnership('user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user not found (null)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMembersForPartnership('missing')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns empty array when no valid members (blank names)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          firstName: '  ',
          lastName: '  ',
          role: 'LICENSEE',
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: 'x@x.com',
          license: null,
        },
      ] as never);
      const result = await service.getMembersForPartnership('organizer-1');
      expect(result).toEqual([]);
    });

    it('returns available members, excluding those with active partnerships', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      const memberList = [
        {
          id: 'u1',
          firstName: 'Alice',
          lastName: 'Martin',
          role: 'LICENSEE',
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: 'alice@test.com',
          license: null,
        },
        {
          id: 'u2',
          firstName: 'Bob',
          lastName: 'Dupont',
          role: 'LICENSEE',
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: 'bob@test.com',
          license: null,
        },
      ];
      prisma.user.findMany.mockResolvedValue(memberList as never);
      prisma.partnership.findMany.mockResolvedValue([{ user1Id: 'u1', user2Id: 'u3' }] as never);
      const result = await service.getMembersForPartnership('organizer-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('u2');
    });

    it('includes secondary club members when secondaryClubId is provided', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser() as never);
      const memberList = [
        {
          id: 'u1',
          firstName: 'Alice',
          lastName: 'Martin',
          role: 'LICENSEE',
          category: null,
          ageGroup: null,
          competitionLevel: null,
          clubName: null,
          passportLevelLatin: null,
          passportLevelStandard: null,
          email: 'alice@test.com',
          license: null,
        },
      ];
      prisma.user.findMany.mockResolvedValue(memberList as never);
      prisma.partnership.findMany.mockResolvedValue([] as never);
      const result = await service.getMembersForPartnership('organizer-1', 'club-2');
      expect(result).toHaveLength(1);
    });
  });
});
```

- [x] **Step 2: Vérifier que le test échoue**

```bash
cd apps/backend && npx jest partnership-query.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './partnership-query.service'`

- [x] **Step 3: Créer l'implémentation**

Créer `apps/backend/src/clubs/partnership-query.service.ts` :

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PartnershipStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';

@Injectable()
export class PartnershipQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getPartnerships(organizerUserId: string, activeOnly = true) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const where: {
      endDate?: null;
      OR?: { clubId?: string; secondaryClubId?: string }[];
    } = {
      OR: [{ clubId }, { secondaryClubId: clubId }],
    };
    if (activeOnly) where.endDate = null;
    const partnerships = await this.prisma.partnership.findMany({
      where,
      include: {
        user1: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        user2: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        secondaryClub: { select: { id: true, name: true } },
      },
      orderBy: [{ endDate: 'asc' }, { startDate: 'desc' }],
    });
    return { partnerships, myClubId: clubId };
  }

  async getClubsForPartnership(organizerUserId: string) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    return this.prisma.club.findMany({
      where: { id: { not: clubId } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async getMembersForPartnership(organizerUserId: string, secondaryClubId?: string) {
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (organizer?.role !== UserRole.CLUB) {
      throw new BadRequestException('Only club role can manage club data');
    }

    const primaryClubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);

    const primaryCondition: Prisma.UserWhereInput = organizer.clubId
      ? { clubId: primaryClubId }
      : organizer.clubName?.trim()
        ? {
            clubName: {
              equals: organizer.clubName.trim(),
              mode: 'insensitive',
            },
          }
        : { clubId: primaryClubId };

    const orConditions: Prisma.UserWhereInput[] = [primaryCondition];
    if (secondaryClubId && secondaryClubId !== primaryClubId) {
      orConditions.push({ clubId: secondaryClubId });
    }

    const members = await this.prisma.user.findMany({
      where: {
        role: UserRole.LICENSEE,
        OR: orConditions,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        category: true,
        ageGroup: true,
        competitionLevel: true,
        clubName: true,
        passportLevelLatin: true,
        passportLevelStandard: true,
        license: {
          select: {
            number: true,
            validUntil: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    const seen = new Set<string>();
    const deduped = members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const valid = deduped.filter(
      (m) => m.firstName.trim().length > 0 && m.lastName.trim().length > 0,
    );

    if (valid.length === 0) {
      return [];
    }

    const memberIds = valid.map((m) => m.id);
    const activePartnerships = await this.prisma.partnership.findMany({
      where: {
        endDate: null,
        status: {
          in: [PartnershipStatus.ACTIVE, PartnershipStatus.PENDING_SECOND_CLUB],
        },
        OR: [{ user1Id: { in: memberIds } }, { user2Id: { in: memberIds } }],
      },
      select: { user1Id: true, user2Id: true },
    });

    const busyIds = new Set<string>();
    for (const p of activePartnerships) {
      busyIds.add(p.user1Id);
      busyIds.add(p.user2Id);
    }

    return valid.filter((m) => !busyIds.has(m.id));
  }
}
```

- [x] **Step 4: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest partnership-query.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 7 tests

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/clubs/partnership-query.service.ts src/clubs/partnership-query.service.spec.ts
git commit -m "feat(clubs): create PartnershipQueryService with read methods"
```

---

### Task 3: Slim down PartnershipService et mettre à jour sa spec

**Files:**

- Modify: `apps/backend/src/clubs/partnership.service.ts`
- Modify: `apps/backend/src/clubs/partnership.service.spec.ts`

- [x] **Step 1: Réécrire partnership.service.ts**

Remplacer le contenu de `apps/backend/src/clubs/partnership.service.ts` :

```typescript
// apps/backend/src/clubs/partnership.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnershipManagementMode, PartnershipStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';
import type { CreatePartnershipDto } from './dto/create-partnership.dto';
import type { EndPartnershipDto } from './dto/end-partnership.dto';
import { computePartnershipSuggestion } from './partnership-suggestion.util';

@Injectable()
export class PartnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createPartnership(organizerUserId: string, dto: CreatePartnershipDto) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, name: true },
    });
    if (!club) throw new NotFoundException('Club not found');
    const [u1, u2] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.user1Id },
        select: {
          clubId: true,
          clubName: true,
          birthDate: true,
          ageGroup: true,
          category: true,
          competitionLevel: true,
          passportLevelLatin: true,
          passportLevelStandard: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: dto.user2Id },
        select: {
          clubId: true,
          clubName: true,
          birthDate: true,
          ageGroup: true,
          category: true,
          competitionLevel: true,
          passportLevelLatin: true,
          passportLevelStandard: true,
        },
      }),
    ]);
    if (!u1 || !u2) throw new NotFoundException('One or both users not found');
    if (dto.user1Id === dto.user2Id)
      throw new BadRequestException('Cannot create partnership with same user');
    const user1Id = dto.user1Id < dto.user2Id ? dto.user1Id : dto.user2Id;
    const user2Id = dto.user1Id < dto.user2Id ? dto.user2Id : dto.user1Id;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    const belongsToPrimary = (u: { clubId: string | null; clubName: string | null }) =>
      u.clubId === clubId || u.clubName?.trim().toLowerCase() === club.name.toLowerCase();

    let secondaryClubId: string | null = null;
    let status: PartnershipStatus = PartnershipStatus.ACTIVE;
    let managementMode: PartnershipManagementMode = PartnershipManagementMode.PRIMARY_ONLY;
    let secondaryClub: { id: string; name: string } | null = null;

    if (dto.secondaryClubId) {
      if (dto.secondaryClubId === clubId) {
        throw new BadRequestException('Le second club doit être différent de votre club');
      }
      secondaryClub = await this.prisma.club.findUnique({
        where: { id: dto.secondaryClubId },
        select: { id: true, name: true },
      });
      if (!secondaryClub) throw new NotFoundException('Second club not found');
      const belongsToSecondary = (u: { clubId: string | null; clubName: string | null }) =>
        u.clubId === dto.secondaryClubId ||
        u.clubName?.trim().toLowerCase() === secondaryClub!.name.toLowerCase();
      if (!belongsToPrimary(u1) && !belongsToSecondary(u1)) {
        throw new BadRequestException(
          'Le premier licencié doit appartenir à votre club ou au club partenaire',
        );
      }
      if (!belongsToPrimary(u2) && !belongsToSecondary(u2)) {
        throw new BadRequestException(
          'Le second licencié doit appartenir à votre club ou au club partenaire',
        );
      }
      secondaryClubId = dto.secondaryClubId;
      status = PartnershipStatus.PENDING_SECOND_CLUB;
      managementMode = dto.managementMode ?? PartnershipManagementMode.BOTH;
    } else {
      if (!belongsToPrimary(u1) || !belongsToPrimary(u2)) {
        throw new BadRequestException('Les deux licenciés doivent être membres de votre club');
      }
    }

    const existingActive = await this.prisma.partnership.findFirst({
      where: {
        user1Id,
        user2Id,
        endDate: null,
        status: {
          in: [PartnershipStatus.ACTIVE, PartnershipStatus.PENDING_SECOND_CLUB],
        },
      },
    });
    if (existingActive) {
      throw new BadRequestException(
        "Un couple actif existe déjà entre ces deux partenaires. Clôturez-le avant d'en créer un nouveau.",
      );
    }

    const partnership = await this.prisma.partnership.create({
      data: {
        clubId,
        secondaryClubId,
        user1Id,
        user2Id,
        startDate,
        status,
        managementMode,
      },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    const { coupleAgeGroup, suggestedLevel, suggestedCategories } = computePartnershipSuggestion(
      u1,
      u2,
      startDate,
    );

    // Notification au club partenaire lorsqu'un couple inter-club est créé
    if (secondaryClub && status === PartnershipStatus.PENDING_SECOND_CLUB) {
      const pLabelUser1 = `${partnership.user1.firstName} ${partnership.user1.lastName}`.trim();
      const pLabelUser2 = `${partnership.user2.firstName} ${partnership.user2.lastName}`.trim();
      const pLabel = pLabelUser1 && pLabelUser2 ? `${pLabelUser1} & ${pLabelUser2}` : 'Un couple';

      let modeLabel: string;
      let inviteOperations = '';
      if (managementMode === PartnershipManagementMode.BOTH) {
        modeLabel = 'Mode : co-gestion (les deux clubs gèrent ce couple).';
        inviteOperations =
          'Les opérations importantes sur ce couple devront être validées par les deux clubs.';
      } else if (managementMode === PartnershipManagementMode.SECONDARY_ONLY) {
        modeLabel = `Mode : gestion par votre club (le club ${club.name} vous délègue la gestion de ce couple).`;
      } else {
        modeLabel = `Mode : gestion par le club ${club.name} (votre club ne gère pas directement ce couple).`;
      }

      const firstSentence =
        managementMode === PartnershipManagementMode.BOTH
          ? `${pLabel} : votre club est invité à co-gérer ce couple avec le club ${club.name}.`
          : managementMode === PartnershipManagementMode.SECONDARY_ONLY
            ? `${pLabel} : votre club est invité à gérer ce couple pour le compte du club ${club.name}.`
            : `${pLabel} : votre club est indiqué comme club partenaire, la gestion reste faite par le club ${club.name}.`;

      const body = [firstSentence, modeLabel, inviteOperations].filter(Boolean).join('\n');

      await this.notifyClubOrganizersForClub(secondaryClub, {
        type: 'partnership_interclub_request',
        title: 'Nouveau couple inter-club à valider',
        body,
        partnershipId: partnership.id,
      });
    }

    return {
      partnership,
      coupleAgeGroup,
      suggestedLevel: suggestedLevel ?? null,
      suggestedCategories,
    };
  }

  async endPartnership(organizerUserId: string, partnershipId: string, dto: EndPartnershipDto) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const p = await this.prisma.partnership.findFirst({
      where: {
        id: partnershipId,
        endDate: null,
        status: PartnershipStatus.ACTIVE,
      },
      select: {
        id: true,
        clubId: true,
        secondaryClubId: true,
        managementMode: true,
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });
    if (!p) throw new NotFoundException('Partnership not found or already ended');
    const canManageAsPrimary =
      p.club.id === clubId &&
      (p.managementMode === PartnershipManagementMode.PRIMARY_ONLY ||
        p.managementMode === PartnershipManagementMode.BOTH);
    const canManageAsSecondary =
      p.secondaryClub?.id === clubId &&
      (p.managementMode === PartnershipManagementMode.SECONDARY_ONLY ||
        p.managementMode === PartnershipManagementMode.BOTH);
    if (!canManageAsPrimary && !canManageAsSecondary) {
      throw new BadRequestException('Seul le club gestionnaire de ce couple peut le clôturer.');
    }
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: { endDate: new Date(dto.endDate) },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    {
      const actingClubId = clubId;
      const otherClub =
        actingClubId === updated.club.id
          ? updated.secondaryClub
          : actingClubId === updated.secondaryClub?.id
            ? updated.club
            : null;
      if (otherClub) {
        const pLabelUser1 = `${updated.user1.firstName} ${updated.user1.lastName}`.trim();
        const pLabelUser2 = `${updated.user2.firstName} ${updated.user2.lastName}`.trim();
        const pLabel = pLabelUser1 && pLabelUser2 ? `${pLabelUser1} & ${pLabelUser2}` : 'Un couple';
        await this.notifyClubOrganizersForClub(otherClub, {
          type: 'partnership_interclub_ended',
          title: 'Couple inter-club clôturé',
          body: `${pLabel} : le couple inter-club a été clôturé par l'autre club.`,
          partnershipId: updated.id,
        });
      }
    }

    return updated;
  }

  async validatePartnership(organizerUserId: string, partnershipId: string, accepted: boolean) {
    const clubId = await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const p = await this.prisma.partnership.findFirst({
      where: {
        id: partnershipId,
        secondaryClubId: clubId,
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        endDate: null,
      },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        club: { select: { id: true, name: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });
    if (!p) {
      throw new NotFoundException(
        'Aucun couple en attente de validation par votre club pour cet ID.',
      );
    }
    const newStatus = accepted ? PartnershipStatus.ACTIVE : PartnershipStatus.REJECTED;
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: { status: newStatus },
      include: {
        user1: { select: { id: true, firstName: true, lastName: true } },
        user2: { select: { id: true, firstName: true, lastName: true } },
        secondaryClub: { select: { id: true, name: true } },
      },
    });

    {
      const pLabelUser1 = `${p.user1.firstName} ${p.user1.lastName}`.trim();
      const pLabelUser2 = `${p.user2.firstName} ${p.user2.lastName}`.trim();
      const pLabel = pLabelUser1 && pLabelUser2 ? `${pLabelUser1} & ${pLabelUser2}` : 'Un couple';
      const decisionText = accepted ? 'validé' : 'refusé';
      const type = accepted ? 'partnership_interclub_accepted' : 'partnership_interclub_rejected';
      await this.notifyClubOrganizersForClub(
        { id: p.club.id, name: p.club.name },
        {
          type,
          title: `Couple inter-club ${decisionText} par le club partenaire`,
          body: `${pLabel} : le club ${
            p.secondaryClub?.name ?? 'partenaire'
          } a ${decisionText} le couple inter-club.`,
          partnershipId: p.id,
        },
      );
    }

    return updated;
  }

  private async notifyClubOrganizersForClub(
    club: { id: string; name: string },
    notification: {
      type: string;
      title: string;
      body: string;
      partnershipId: string;
    },
  ): Promise<void> {
    const organizers = await this.prisma.user.findMany({
      where: {
        role: 'CLUB' as const,
        OR: [
          { clubId: club.id },
          {
            clubName: {
              equals: club.name.trim(),
              mode: 'insensitive',
            },
          },
        ],
      },
      select: { id: true },
    });
    if (organizers.length === 0) return;
    const data: Record<string, string> = {
      type: notification.type,
      partnershipId: notification.partnershipId,
    };
    await Promise.all(
      organizers.map((o) =>
        this.notificationsService.createForUser(o.id, notification.title, notification.body, data),
      ),
    );
  }
}
```

- [x] **Step 2: Mettre à jour partnership.service.spec.ts**

Supprimer les describes `getPartnerships`, `getClubsForPartnership`, `getMembersForPartnership` du fichier. Le fichier spec ne garde que `createPartnership`, `endPartnership`, `endPartnership — additional`, `validatePartnership`.

Remplacer le contenu de `apps/backend/src/clubs/partnership.service.spec.ts` :

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

  // ----------------------------------------------------------------
  // createPartnership
  // ----------------------------------------------------------------
  describe('createPartnership', () => {
    const baseOrganizer = 'organizer-1';

    it('throws BadRequestException when user1Id === user2Id', async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique.mockResolvedValue(makeUser({ clubId: 'club-1' }) as never);
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: 'same-id',
          user2Id: 'same-id',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when users do not belong to the club', async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ clubId: 'other-club' }) as never)
        .mockResolvedValueOnce(makeUser({ clubId: 'other-club' }) as never);
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: 'user-a',
          user2Id: 'user-b',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when active partnership already exists', async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ id: 'user-a', clubId: 'club-1' }) as never)
        .mockResolvedValueOnce(makeUser({ id: 'user-b', clubId: 'club-1' }) as never);
      prisma.partnership.findFirst.mockResolvedValue(makePartnership() as never);
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: 'user-a',
          user2Id: 'user-b',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates partnership with ACTIVE status for same-club couple', async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ id: 'user-a', clubId: 'club-1' }) as never)
        .mockResolvedValueOnce(makeUser({ id: 'user-b', clubId: 'club-1' }) as never);
      prisma.partnership.findFirst.mockResolvedValue(null);
      prisma.partnership.create.mockResolvedValue(makePartnership() as never);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.createPartnership(baseOrganizer, {
        user1Id: 'user-a',
        user2Id: 'user-b',
      });

      expect(result.partnership).toBeDefined();
      expect(prisma.partnership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PartnershipStatus.ACTIVE }),
        }),
      );
    });

    it('creates partnership with PENDING_SECOND_CLUB status for inter-club couple', async () => {
      prisma.club.findUnique
        .mockResolvedValueOnce(makeClub() as never)
        .mockResolvedValueOnce({ id: 'club-2', name: 'Other Club' } as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ id: 'user-a', clubId: 'club-1' }) as never)
        .mockResolvedValueOnce(makeUser({ id: 'user-b', clubId: 'club-2' }) as never);
      prisma.partnership.findFirst.mockResolvedValue(null);
      prisma.partnership.create.mockResolvedValue(
        makePartnership({
          secondaryClubId: 'club-2',
          secondaryClub: { id: 'club-2', name: 'Other Club' },
          status: PartnershipStatus.PENDING_SECOND_CLUB,
        }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.createPartnership(baseOrganizer, {
        user1Id: 'user-a',
        user2Id: 'user-b',
        secondaryClubId: 'club-2',
      });

      expect(result.partnership.status).toBe(PartnershipStatus.PENDING_SECOND_CLUB);
    });

    it("throws BadRequestException when secondaryClubId equals the organizer's own clubId", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ id: 'user-a', clubId: 'club-1' }) as never)
        .mockResolvedValueOnce(makeUser({ id: 'user-b', clubId: 'club-1' }) as never);
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: 'user-a',
          user2Id: 'user-b',
          secondaryClubId: 'club-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ----------------------------------------------------------------
  // endPartnership
  // ----------------------------------------------------------------
  describe('endPartnership', () => {
    it('throws NotFoundException when partnership not found', async () => {
      prisma.partnership.findFirst.mockResolvedValue(null);
      await expect(
        service.endPartnership('organizer-1', 'partnership-1', {
          endDate: '2024-06-01',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when club has no management rights', async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.PRIMARY_ONLY,
          club: { id: 'club-1', name: 'Test Club' },
          secondaryClub: { id: 'club-2', name: 'Other Club' },
        }) as never,
      );
      clubsService.getClubIdForOrganizer.mockResolvedValue('club-2');
      await expect(
        service.endPartnership('organizer-2', 'partnership-1', {
          endDate: '2024-06-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ends partnership successfully when primary club has PRIMARY_ONLY rights', async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.PRIMARY_ONLY,
          club: { id: 'club-1', name: 'Test Club' },
          secondaryClub: null,
        }) as never,
      );
      const ended = makePartnership({
        endDate: new Date('2024-06-01'),
        club: { id: 'club-1', name: 'Test Club' },
        secondaryClub: null,
      });
      prisma.partnership.update.mockResolvedValue(ended as never);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.endPartnership('organizer-1', 'partnership-1', {
        endDate: '2024-06-01',
      });
      expect(result.endDate).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // endPartnership — additional branches
  // ----------------------------------------------------------------
  describe('endPartnership — additional', () => {
    it('ends partnership when secondary club has BOTH rights', async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.BOTH,
          club: { id: 'club-1', name: 'Test Club' },
          secondaryClub: { id: 'club-2', name: 'Other Club' },
        }) as never,
      );
      clubsService.getClubIdForOrganizer.mockResolvedValue('club-2');
      const ended = makePartnership({
        endDate: new Date('2024-06-01'),
        club: { id: 'club-1', name: 'Test Club' },
        secondaryClub: { id: 'club-2', name: 'Other Club' },
      });
      prisma.partnership.update.mockResolvedValue(ended as never);
      prisma.user.findMany.mockResolvedValue([{ id: 'org-1' }] as never);
      mockNotifications.createForUser.mockResolvedValue(undefined);

      const result = await service.endPartnership('organizer-2', 'partnership-1', {
        endDate: '2024-06-01',
      });
      expect(result.endDate).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // validatePartnership
  // ----------------------------------------------------------------
  describe('validatePartnership', () => {
    it('throws NotFoundException when pending partnership not found', async () => {
      prisma.partnership.findFirst.mockResolvedValue(null);
      await expect(
        service.validatePartnership('organizer-1', 'partnership-1', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets status to ACTIVE when accepted=true', async () => {
      const pending = makePartnership({
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        secondaryClubId: 'club-1',
        secondaryClub: { id: 'club-1', name: 'Test Club' },
      });
      prisma.partnership.findFirst.mockResolvedValue(pending as never);
      prisma.partnership.update.mockResolvedValue(
        makePartnership({ status: PartnershipStatus.ACTIVE }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);
      const result = await service.validatePartnership('organizer-1', 'partnership-1', true);
      expect(prisma.partnership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PartnershipStatus.ACTIVE },
        }),
      );
      expect(result.status).toBe(PartnershipStatus.ACTIVE);
    });

    it('sets status to REJECTED when accepted=false', async () => {
      const pending = makePartnership({
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        secondaryClubId: 'club-1',
        secondaryClub: { id: 'club-1', name: 'Test Club' },
      });
      prisma.partnership.findFirst.mockResolvedValue(pending as never);
      prisma.partnership.update.mockResolvedValue(
        makePartnership({ status: PartnershipStatus.REJECTED }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);
      const result = await service.validatePartnership('organizer-1', 'partnership-1', false);
      expect(prisma.partnership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PartnershipStatus.REJECTED },
        }),
      );
      expect(result.status).toBe(PartnershipStatus.REJECTED);
    });
  });
});
```

- [x] **Step 3: Vérifier que les tests passent**

```bash
cd apps/backend && npx jest partnership.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 11 tests

- [x] **Step 4: Vérifier toutes les suites clubs**

```bash
cd apps/backend && npx jest src/clubs --no-coverage 2>&1 | tail -15
```

Expected: PASS — partnership.service, partnership-query.service, partnership-suggestion.util, + autres suites clubs

- [x] **Step 5: Commit**

```bash
cd apps/backend && git add src/clubs/partnership.service.ts src/clubs/partnership.service.spec.ts
git commit -m "refactor(clubs): slim down PartnershipService, use computePartnershipSuggestion"
```

---

### Task 4: Mettre à jour ClubsModule

**Files:**

- Modify: `apps/backend/src/clubs/clubs.module.ts`

- [x] **Step 1: Mettre à jour clubs.module.ts**

Remplacer le contenu de `apps/backend/src/clubs/clubs.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { ClubsController } from './clubs.controller';
import { ClubsHelloAssoService } from './clubs-helloasso.service';
import { ClubsService } from './clubs.service';
import { PartnershipQueryService } from './partnership-query.service';
import { PartnershipService } from './partnership.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SoloTeamService } from './solo-team.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClubsController],
  providers: [
    ClubsService,
    ClubsHelloAssoService,
    PartnershipService,
    PartnershipQueryService,
    SoloTeamService,
  ],
  exports: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
})
export class ClubsModule {}
```

Note: `NotificationsService` n'est pas dans les providers car il est injecté via un autre module (vérifier s'il nécessite un import). Si la compilation échoue avec une erreur sur `NotificationsService`, ajouter `NotificationsModule` dans les imports — mais d'abord tenter sans.

- [x] **Step 2: Vérifier que toute la suite de tests passe**

```bash
cd apps/backend && npx jest --no-coverage 2>&1 | tail -10
```

Expected: toutes les suites passent

- [x] **Step 3: Vérifier le typecheck TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: aucune erreur

- [x] **Step 4: Commit**

```bash
cd apps/backend && git add src/clubs/clubs.module.ts
git commit -m "feat(clubs): add PartnershipQueryService to ClubsModule"
```
