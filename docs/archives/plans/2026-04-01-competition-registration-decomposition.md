# Competition Registration Service Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extraire la logique de notification et la méthode de lecture `getPendingRegistrationsForClub` de `CompetitionRegistrationService` (692 lignes) vers des services dédiés, sans changer le comportement observable.

**Architecture:** `RegistrationNotificationService` (nouveau) reçoit toute la logique de notification (3 méthodes publiques + `notifyClubOrganizers` privée). `CompetitionQueryService` (existant) reçoit `getPendingRegistrationsForClub`. `CompetitionRegistrationService` délègue aux deux et perd ~280 lignes.

**Tech Stack:** NestJS, Prisma, Jest (mocks manuels via `createMockPrismaService`), TypeScript strict.

---

## Fichiers

- Create: `apps/backend/src/competitions/services/registration-notification.service.ts`
- Create: `apps/backend/src/competitions/services/registration-notification.service.spec.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`
- Modify: `apps/backend/src/competitions/services/competition-query.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-query.service.spec.ts`
- Modify: `apps/backend/src/competitions/competitions.module.ts`
- Modify: `apps/backend/src/competitions/competitions.controller.ts`

---

### Task 1 : Créer RegistrationNotificationService avec spec

**Files:**

- Create: `apps/backend/src/competitions/services/registration-notification.service.ts`
- Create: `apps/backend/src/competitions/services/registration-notification.service.spec.ts`

- [x] **Step 1 : Écrire la spec qui échoue**

Créer `apps/backend/src/competitions/services/registration-notification.service.spec.ts` :

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationStatus } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../__mocks__/types';
import { RegistrationNotificationService } from './registration-notification.service';

const mockPrismaService = createMockPrismaService();
const mockNotificationsService = {
  createForUser: jest.fn().mockResolvedValue(undefined),
};

describe('RegistrationNotificationService', () => {
  let service: RegistrationNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationNotificationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService as unknown as PrismaService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<RegistrationNotificationService>(RegistrationNotificationService);
    jest.clearAllMocks();
  });

  describe('notifyOnRegister', () => {
    it('sends inscription-by-club notification when byOrganizer is true', async () => {
      await service.notifyOnRegister(
        { id: 'r1', userId: 'u1' },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        null,
        { byOrganizer: true, initialStatus: RegistrationStatus.CONFIRMED },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Inscription par le club',
        expect.stringContaining('Comp'),
        expect.objectContaining({ type: 'registration_by_club' }),
      );
    });

    it('sends auto-confirmed notification and notifies club organizers when MEMBERS_AUTO_CONFIRM', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'org-1' }]);

      await service.notifyOnRegister(
        { id: 'r1', userId: 'u1' },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        { firstName: 'Jean', lastName: 'Dupont', clubId: 'club-1', clubName: null },
        { byOrganizer: false, initialStatus: RegistrationStatus.CONFIRMED },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Inscription validée',
        expect.any(String),
        expect.objectContaining({ type: 'registration_auto_confirmed' }),
      );
      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'org-1',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: 'club_member_auto_registered' }),
      );
    });

    it('sends pending notification and notifies club organizers when PENDING', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'org-2' }]);

      await service.notifyOnRegister(
        { id: 'r1', userId: 'u1' },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        { firstName: 'Jean', lastName: 'Dupont', clubId: 'club-1', clubName: null },
        { byOrganizer: false, initialStatus: RegistrationStatus.PENDING },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Inscription en attente',
        expect.any(String),
        expect.objectContaining({ type: 'registration_pending' }),
      );
      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'org-2',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: 'club_member_pending_registration' }),
      );
    });
  });

  describe('notifyOnUnregister', () => {
    it('sends refused-by-club notification when byOrganizer unregisters a PENDING registration', async () => {
      await service.notifyOnUnregister(
        { id: 'r1', userId: 'u1', status: RegistrationStatus.PENDING },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        null,
        { byOrganizer: true, organizerUserId: 'org-1' },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Inscription refusée par le club',
        expect.any(String),
        expect.objectContaining({ type: 'registration_refused_by_club' }),
      );
    });

    it('sends unregistration-by-club notification when byOrganizer unregisters a CONFIRMED registration', async () => {
      await service.notifyOnUnregister(
        { id: 'r1', userId: 'u1', status: RegistrationStatus.CONFIRMED },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        null,
        { byOrganizer: true, organizerUserId: 'org-1' },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Désinscription par le club',
        expect.any(String),
        expect.objectContaining({ type: 'unregistration_by_club' }),
      );
    });

    it('notifies club organizers when member self-unregisters and has clubId', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'org-1' }]);

      await service.notifyOnUnregister(
        { id: 'r1', userId: 'u1', status: RegistrationStatus.CONFIRMED },
        {
          competitionId: 'c1',
          id: 'e1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
        { firstName: 'Jean', lastName: 'Dupont', clubId: 'club-1', clubName: null },
        { byOrganizer: false },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'org-1',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: 'club_member_unregistered' }),
      );
    });
  });

  describe('notifyOnConfirm', () => {
    it('sends confirmed-by-club notification to the member', async () => {
      await service.notifyOnConfirm(
        { id: 'r1', userId: 'u1', eventId: 'e1' },
        {
          competitionId: 'c1',
          competition: { title: 'Comp' },
          category: 'Latin',
          ageGroup: 'Adulte',
        },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        'u1',
        'Inscription validée par le club',
        expect.stringContaining('Comp'),
        expect.objectContaining({ type: 'registration_confirmed_by_club' }),
      );
    });
  });
});
```

- [x] **Step 2 : Vérifier que la spec échoue**

```bash
cd /path/to/worktree/apps/backend && npx jest registration-notification.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './registration-notification.service'`

- [x] **Step 3 : Créer l'implémentation**

Créer `apps/backend/src/competitions/services/registration-notification.service.ts` :

```typescript
import { Injectable } from "@nestjs/common";
import { RegistrationStatus, UserRole } from "@prisma/client";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";

interface RegistrationRef {
  id: string;
  userId: string;
  eventId?: string;
  status?: RegistrationStatus;
}

interface EventRef {
  id: string;
  competitionId: string;
  category: string | null;
  ageGroup: string | null;
  competition: { title: string };
}

interface MemberRef {
  firstName: string | null;
  lastName: string | null;
  clubId: string | null;
  clubName: string | null;
} | null | undefined;

interface RegisterNotifyOptions {
  byOrganizer: boolean;
  initialStatus: RegistrationStatus;
}

interface UnregisterNotifyOptions {
  byOrganizer?: boolean;
  organizerUserId?: string;
}

@Injectable()
export class RegistrationNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async notifyOnRegister(
    registration: RegistrationRef,
    event: EventRef,
    member: MemberRef,
    options: RegisterNotifyOptions,
  ): Promise<void> {
    const compTitle = event.competition.title;
    const eventLabel = `${event.category ?? ""} ${event.ageGroup ?? ""}`.trim();
    const { byOrganizer, initialStatus } = options;

    if (byOrganizer) {
      await this.notificationsService.createForUser(
        registration.userId,
        "Inscription par le club",
        `Le club vous a inscrit à "${compTitle}" - ${eventLabel}.`,
        {
          type: "registration_by_club",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
      return;
    }

    const memberName =
      member?.firstName && member.lastName
        ? `${member.firstName} ${member.lastName}`.trim()
        : "Un licencié";

    if (initialStatus === RegistrationStatus.CONFIRMED) {
      await this.notificationsService.createForUser(
        registration.userId,
        "Inscription validée",
        `Votre inscription à "${compTitle}" - ${eventLabel} est confirmée.`,
        {
          type: "registration_auto_confirmed",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
      await this.notifyClubOrganizers(member, event.competitionId, event.id, registration.id, {
        type: "club_member_auto_registered",
        title: "Inscription d'un licencié",
        body: `${memberName} s'est inscrit à "${compTitle}" - ${eventLabel}.`,
      });
    } else {
      await this.notificationsService.createForUser(
        registration.userId,
        "Inscription en attente",
        `Votre inscription à "${compTitle}" - ${eventLabel} est en attente de validation par votre club.`,
        {
          type: "registration_pending",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
      await this.notifyClubOrganizers(member, event.competitionId, event.id, registration.id, {
        type: "club_member_pending_registration",
        title: "Inscription en attente de validation",
        body: `${memberName} a une inscription en attente pour "${compTitle}" - ${eventLabel}.`,
      });
    }
  }

  async notifyOnUnregister(
    registration: RegistrationRef,
    event: EventRef,
    member: MemberRef,
    options: UnregisterNotifyOptions,
  ): Promise<void> {
    const compTitle = event.competition.title;
    const eventLabel = `${event.category ?? ""} ${event.ageGroup ?? ""}`.trim();

    if (options.byOrganizer && options.organizerUserId && options.organizerUserId !== registration.userId) {
      const wasPending = registration.status === RegistrationStatus.PENDING;
      await this.notificationsService.createForUser(
        registration.userId,
        wasPending ? "Inscription refusée par le club" : "Désinscription par le club",
        wasPending
          ? `Votre inscription à "${compTitle}" - ${eventLabel} n'a pas été validée par le club.`
          : `Le club vous a désinscrit de "${compTitle}" - ${eventLabel}.`,
        {
          type: wasPending ? "registration_refused_by_club" : "unregistration_by_club",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
    } else {
      const memberName =
        member?.firstName && member.lastName
          ? `${member.firstName} ${member.lastName}`.trim()
          : "Un licencié";
      await this.notifyClubOrganizers(member, event.competitionId, event.id, registration.id, {
        type: "club_member_unregistered",
        title: "Désinscription d'un licencié",
        body: `${memberName} s'est désinscrit de "${compTitle}" - ${eventLabel}.`,
      });
    }
  }

  async notifyOnConfirm(
    registration: RegistrationRef,
    event: EventRef,
  ): Promise<void> {
    const compTitle = event.competition.title;
    const eventLabel = `${event.category ?? ""} ${event.ageGroup ?? ""}`.trim();

    await this.notificationsService.createForUser(
      registration.userId,
      "Inscription validée par le club",
      `Votre inscription à "${compTitle}" - ${eventLabel} a été validée par le club.`,
      {
        type: "registration_confirmed_by_club",
        competitionId: event.competitionId,
        eventId: event.id ?? "",
        registrationId: registration.id,
      },
    );
  }

  private async notifyClubOrganizers(
    member: MemberRef,
    competitionId: string,
    eventId: string,
    registrationId: string,
    notification: { type: string; title: string; body: string },
  ): Promise<void> {
    if (!member?.clubId && !member?.clubName?.trim()) return;

    const sameClubCondition = member.clubId
      ? { clubId: member.clubId }
      : {
          clubName: {
            equals: member.clubName!.trim(),
            mode: "insensitive" as const,
          },
        };

    const organizers = await this.prisma.user.findMany({
      where: { role: UserRole.CLUB, ...sameClubCondition },
      select: { id: true },
    });

    const data: Record<string, string> = {
      type: notification.type,
      competitionId,
      eventId,
      registrationId,
    };

    await Promise.all(
      organizers.map((o) =>
        this.notificationsService.createForUser(
          o.id,
          notification.title,
          notification.body,
          data,
        ),
      ),
    );
  }
}
```

- [x] **Step 4 : Vérifier que les tests passent**

```bash
cd apps/backend && npx jest registration-notification.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 7 tests

- [x] **Step 5 : Commit**

```bash
git add apps/backend/src/competitions/services/registration-notification.service.ts apps/backend/src/competitions/services/registration-notification.service.spec.ts
git commit -m "feat(competitions): create RegistrationNotificationService"
```

---

### Task 2 : Slim down CompetitionRegistrationService

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`

- [x] **Step 1 : Mettre à jour competition-registration.service.ts**

Remplacer le contenu complet de `apps/backend/src/competitions/services/competition-registration.service.ts` :

```typescript
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClubRegistrationMode, EventType, RegistrationStatus, UserRole } from '@prisma/client';
import {
  computeCoupleAgeGroup,
  computeSoloAgeGroup,
  getReferenceYear,
} from '../../common/age-group';
import { checkParticipationEligibility } from '../../common/participation-rules';
import { handlePrismaError } from '../../utils/prisma-errors.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubsHelloAssoService } from '../../clubs/clubs-helloasso.service';
import { CompetitionCacheService } from './competition-cache.service';
import { RegistrationNotificationService } from './registration-notification.service';

export interface RegisterOptions {
  /** Inscription effectuée par le club (organisateur) → statut CONFIRMED + notification */
  byOrganizer?: boolean;
  /** Profil couple : classe d'âge (sinon calculée si birthDate connus, ou déduite de l'épreuve) */
  coupleAgeGroup?: string;
  /** Le couple pratique la discipline Latine */
  coupleDisciplineLatin?: boolean;
  /** Le couple pratique la discipline Standard */
  coupleDisciplineStandard?: boolean;
  /** Partenaire licencié (pour calcul auto de la classe d'âge couple) */
  partnerUserId?: string;
  /** Niveau du couple/solo (obligatoire pour épreuves classificatrices) */
  registrantLevel?: string;
}

export interface UnregisterOptions {
  /** Désinscription par le club → notifier le membre */
  byOrganizer?: boolean;
  organizerUserId?: string;
}

@Injectable()
export class CompetitionRegistrationService {
  private readonly logger = new Logger(CompetitionRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly notificationService: RegistrationNotificationService,
  ) {}

  async register(
    eventId: string,
    userId: string,
    partnerName?: string,
    options: RegisterOptions = {},
  ) {
    this.logger.log(`Registering user ${userId} for event ${eventId}`);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { competition: true },
    });

    if (!event) {
      throw new NotFoundException('Événement non trouvé');
    }

    // Épreuve couple : partenaire obligatoire. Épreuve solo : pas de partenaire.
    if (event.eventType === EventType.COUPLE && !partnerName?.trim() && !options.partnerUserId) {
      throw new BadRequestException(
        'Cette épreuve est en couple. Indiquez le nom de votre partenaire (ou son compte licencié) pour vous inscrire.',
      );
    }
    if (event.eventType === EventType.SOLO && (partnerName?.trim() || options.partnerUserId)) {
      throw new BadRequestException(
        "Cette épreuve est en solo. L'inscription se fait sans partenaire.",
      );
    }

    const existing = await this.prisma.registration.findFirst({
      where: {
        eventId,
        userId,
        status: {
          in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
        },
      },
    });

    if (existing) {
      throw new ConflictException('Déjà inscrit à cet événement');
    }

    let initialStatus: RegistrationStatus = RegistrationStatus.PENDING;
    if (options.byOrganizer) {
      initialStatus = RegistrationStatus.CONFIRMED;
    } else {
      const mode = await this.clubsHelloAssoService.getRegistrationModeForUser(userId);
      if (mode === ClubRegistrationMode.CLUB_ONLY) {
        throw new ForbiddenException(
          "Votre club n'autorise pas les inscriptions par les licenciés. Contactez votre club pour vous inscrire.",
        );
      }
      if (mode === ClubRegistrationMode.MEMBERS_AUTO_CONFIRM) {
        initialStatus = RegistrationStatus.CONFIRMED;
      }
    }

    const isCouple = event.eventType === EventType.COUPLE;
    const cat = (event.category || '').toLowerCase();
    const referenceYear = getReferenceYear(event.competition.date);

    // Calcul automatique de la classe d'âge (Article 5 FFDanse)
    let computedAgeGroup: string | null = null;
    const registrant = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true },
    });
    if (event.eventType === EventType.SOLO && registrant?.birthDate) {
      computedAgeGroup = computeSoloAgeGroup(registrant.birthDate, referenceYear);
    }
    let partnerDisplayName: string | null = partnerName?.trim() ? partnerName.trim() : null;
    if (event.eventType === EventType.COUPLE && registrant?.birthDate && options.partnerUserId) {
      const partner = await this.prisma.user.findUnique({
        where: { id: options.partnerUserId },
        select: { birthDate: true, firstName: true, lastName: true },
      });
      if (partner?.birthDate) {
        computedAgeGroup = computeCoupleAgeGroup(
          registrant.birthDate,
          partner.birthDate,
          referenceYear,
        );
      }
      if (!partnerDisplayName && partner?.firstName != null) {
        partnerDisplayName = `${partner.firstName} ${partner.lastName}`.trim();
      }
    }

    const finalPartnerName = event.eventType === EventType.SOLO ? null : partnerDisplayName;
    const finalAgeGroup =
      computedAgeGroup ??
      (isCouple && options.coupleAgeGroup?.trim() ? options.coupleAgeGroup.trim() : null);

    // Règle Article 9 : éligibilité classe d'âge et niveau (classificatrice / open)
    const competitionType = event.competition.competitionType ?? null;
    const eventKind = event.eventKind ?? null;
    const eventLevel = event.level ?? null;
    if (finalAgeGroup) {
      const eligibility = checkParticipationEligibility({
        eventType: event.eventType,
        eventAgeGroup: event.ageGroup,
        eventCategory: event.category,
        eventLevel: eventLevel ?? undefined,
        eventKind: eventKind ?? undefined,
        competitionType: competitionType ?? undefined,
        registrantAgeGroup: finalAgeGroup,
        registrantLevel: options.registrantLevel?.trim()
          ? options.registrantLevel.trim()
          : undefined,
      });
      if (!eligibility.allowed) {
        throw new BadRequestException(
          eligibility.reason ?? 'Participation non autorisée pour cette épreuve.',
        );
      }
    }

    // Article 9 §1.2 : en majeures (championnat régional, coupe de France), une seule épreuve par spécialité
    if (competitionType === 'MAJEURE' && eventKind === 'MAJEURE') {
      const otherInSameSpecialty = await this.prisma.registration.findFirst({
        where: {
          userId,
          status: {
            in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
          },
          eventId: { not: eventId },
          event: {
            competitionId: event.competitionId,
            category: event.category,
          },
        },
      });
      if (otherInSameSpecialty) {
        throw new BadRequestException(
          `En compétition majeure, un couple ou solo ne peut participer qu'à une seule épreuve par spécialité (${event.category}). Vous êtes déjà inscrit à une épreuve ${event.category}.`,
        );
      }
    }

    const registration = await this.prisma.registration
      .create({
        data: {
          eventId,
          userId,
          partnerName: finalPartnerName,
          partnerUserId: isCouple ? (options.partnerUserId ?? null) : null,
          status: initialStatus,
          coupleAgeGroup: finalAgeGroup,
          coupleDisciplineLatin: isCouple
            ? (options.coupleDisciplineLatin ?? (cat === 'latin' || cat === 'ten dance'))
            : false,
          coupleDisciplineStandard: isCouple
            ? (options.coupleDisciplineStandard ?? (cat === 'standard' || cat === 'ten dance'))
            : false,
        },
      })
      .catch((err) => handlePrismaError(err, 'Registration'));

    // Mise à jour automatique de la classe d'âge du licencié (Article 5 – année civile en cours)
    if (registrant?.birthDate) {
      const currentYear = getReferenceYear(null);
      const soloGroup = computeSoloAgeGroup(registrant.birthDate, currentYear);
      if (soloGroup) {
        await this.prisma.user
          .update({
            where: { id: userId },
            data: { ageGroup: soloGroup },
          })
          .catch(() => {
            // Ne pas faire échouer l'inscription si la mise à jour du profil échoue
          });
      }
    }

    await this.cacheService.invalidateCompetition(event.competitionId, userId);

    const member = options.byOrganizer
      ? null
      : await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            firstName: true,
            lastName: true,
            clubId: true,
            clubName: true,
          },
        });

    await this.notificationService.notifyOnRegister(registration, event, member, {
      byOrganizer: options.byOrganizer ?? false,
      initialStatus,
    });

    return registration;
  }

  async confirmRegistration(registrationId: string, organizerUserId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: { include: { competition: true } },
        user: { select: { id: true, clubId: true, clubName: true } },
      },
    });
    if (!registration) {
      throw new NotFoundException('Inscription non trouvée');
    }
    if (registration.status !== RegistrationStatus.PENDING) {
      throw new ConflictException("Cette inscription n'est pas en attente de validation");
    }

    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (organizer?.role !== UserRole.CLUB) {
      throw new ForbiddenException("Réservé à l'organisateur du club");
    }
    const sameClub =
      organizer.clubId && registration.user.clubId
        ? organizer.clubId === registration.user.clubId
        : organizer.clubName?.trim() && registration.user.clubName?.trim()
          ? organizer.clubName.trim().toLowerCase() ===
            registration.user.clubName.trim().toLowerCase()
          : false;
    if (!sameClub) {
      throw new ForbiddenException(
        'Vous ne pouvez valider que les inscriptions des membres de votre club',
      );
    }

    const updated = await this.prisma.registration.update({
      where: { id: registrationId },
      data: { status: RegistrationStatus.CONFIRMED },
    });

    await this.cacheService.invalidateCompetition(
      registration.event.competitionId,
      registration.userId,
    );

    await this.notificationService.notifyOnConfirm(
      { id: registration.id, userId: registration.userId, eventId: registration.eventId },
      registration.event,
    );

    return updated;
  }

  async unregister(eventId: string, userId: string, options: UnregisterOptions = {}) {
    this.logger.log(`Unregistering user ${userId} from event ${eventId}`);

    const registration = await this.prisma.registration.findFirst({
      where: {
        eventId,
        userId,
        status: {
          in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
        },
      },
      include: { event: { include: { competition: true } } },
    });

    if (!registration) {
      throw new NotFoundException('Inscription non trouvée');
    }

    const result = await this.prisma.registration.update({
      where: { id: registration.id },
      data: { status: RegistrationStatus.CANCELLED },
    });

    await this.cacheService.invalidateCompetition(registration.event.competitionId, userId);

    const member =
      options.byOrganizer && options.organizerUserId && options.organizerUserId !== userId
        ? null
        : await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
              firstName: true,
              lastName: true,
              clubId: true,
              clubName: true,
            },
          });

    await this.notificationService.notifyOnUnregister(
      { id: registration.id, userId, status: registration.status },
      registration.event,
      member,
      options,
    );

    return result;
  }

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
    await this.ensureMemberBelongsToOrganizerClub(organizerUserId, memberUserId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { competition: true },
    });
    if (!event) throw new NotFoundException('Événement non trouvé');
    return this.register(eventId, memberUserId, partnerName, {
      byOrganizer: true,
      ...coupleOptions,
    });
  }

  async unregisterMember(organizerUserId: string, eventId: string, memberUserId: string) {
    await this.ensureMemberBelongsToOrganizerClub(organizerUserId, memberUserId);
    return this.unregister(eventId, memberUserId, {
      byOrganizer: true,
      organizerUserId,
    });
  }

  private async ensureMemberBelongsToOrganizerClub(organizerUserId: string, memberUserId: string) {
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
    if (!member) throw new NotFoundException('Membre non trouvé');

    const sameClub =
      organizer.clubId && member.clubId
        ? organizer.clubId === member.clubId
        : organizer.clubName?.trim() && member.clubName?.trim()
          ? organizer.clubName.trim().toLowerCase() === member.clubName.trim().toLowerCase()
          : false;

    if (!sameClub) {
      throw new NotFoundException('Vous ne pouvez inscrire que les membres de votre club');
    }
  }
}
```

- [x] **Step 2 : Mettre à jour competition-registration.service.spec.ts**

Remplacer l'import de `NotificationsService` par `RegistrationNotificationService` et mettre à jour le provider :

Dans le fichier `apps/backend/src/competitions/services/competition-registration.service.spec.ts`, remplacer :

```typescript
import { NotificationsService } from '../../notifications/notifications.service';
```

par :

```typescript
import { RegistrationNotificationService } from './registration-notification.service';
```

Remplacer le mock :

```typescript
const mockNotificationsService = {
  createForUser: jest.fn().mockResolvedValue(undefined),
};
```

par :

```typescript
const mockNotificationService = {
  notifyOnRegister: jest.fn().mockResolvedValue(undefined),
  notifyOnUnregister: jest.fn().mockResolvedValue(undefined),
  notifyOnConfirm: jest.fn().mockResolvedValue(undefined),
};
```

Dans `beforeEach`, remplacer le provider :

```typescript
{ provide: NotificationsService, useValue: mockNotificationsService },
```

par :

```typescript
{ provide: RegistrationNotificationService, useValue: mockNotificationService },
```

Remplacer les 4 assertions `mockNotificationsService.createForUser` dans les tests par `mockNotificationService.notifyOnRegister` ou `mockNotificationService.notifyOnUnregister` selon le contexte :

- Dans `"should register user successfully..."` (ligne ~89) : remplacer `expect(mockNotificationsService.createForUser).toHaveBeenCalled()` par `expect(mockNotificationService.notifyOnRegister).toHaveBeenCalled()`
- Dans `"sends 'refused by club' notification..."` et `"sends 'unregistered by club'..."` et `"notifies club organizers when user self-unregisters..."` (lignes ~661-726) : remplacer `expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(...)` par `expect(mockNotificationService.notifyOnUnregister).toHaveBeenCalled()`
- Dans `"confirms a pending registration successfully"` (ligne ~600) et `"matches by clubName..."` (ligne ~624) : remplacer `expect(mockNotificationsService.createForUser).toHaveBeenCalled()` par `expect(mockNotificationService.notifyOnConfirm).toHaveBeenCalled()`

Supprimer aussi le describe `getPendingRegistrationsForClub` (lignes 804-871) — cette méthode sera déplacée dans CompetitionQueryService.

- [x] **Step 3 : Vérifier que les tests competition-registration passent**

```bash
cd apps/backend && npx jest competition-registration.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — tous les tests sauf `getPendingRegistrationsForClub` (describe supprimé)

- [x] **Step 4 : Commit**

```bash
git add apps/backend/src/competitions/services/competition-registration.service.ts apps/backend/src/competitions/services/competition-registration.service.spec.ts
git commit -m "refactor(competitions): delegate notifications to RegistrationNotificationService"
```

---

### Task 3 : Étendre CompetitionQueryService avec getPendingRegistrationsForClub

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-query.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-query.service.spec.ts`

- [x] **Step 1 : Ajouter la méthode dans competition-query.service.ts**

Ajouter l'import manquant en haut de `competition-query.service.ts` :

```typescript
import { UserRole } from '@prisma/client';
```

Ajouter la méthode à la fin de la classe `CompetitionQueryService`, avant la dernière accolade `}` :

```typescript
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
```

- [x] **Step 2 : Ajouter les tests dans competition-query.service.spec.ts**

Ajouter à la fin de `describe("CompetitionQueryService", ...)` dans `apps/backend/src/competitions/services/competition-query.service.spec.ts`, avant la dernière accolade `})` :

```typescript
describe('getPendingRegistrationsForClub', () => {
  it('returns empty array when organizer is not CLUB role', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: 'LICENSEE',
      clubId: 'club-1',
      clubName: null,
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });

  it('returns empty array when organizer has no club', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: 'CLUB',
      clubId: null,
      clubName: null,
    });

    const result = await service.getPendingRegistrationsForClub('user-1');

    expect(result).toEqual([]);
  });

  it('returns pending registrations with competition info', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: 'CLUB',
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
      {
        id: 'comp-1',
        title: 'Championnat 2026',
        date: new Date('2026-06-01'),
      },
    ]);

    const result = await service.getPendingRegistrationsForClub('organizer-1');

    expect(result).toHaveLength(1);
    expect(result[0].competition).toEqual(
      expect.objectContaining({ id: 'comp-1', title: 'Championnat 2026' }),
    );
  });
});
```

- [x] **Step 3 : Vérifier que les tests competition-query passent**

```bash
cd apps/backend && npx jest competition-query.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — tous les tests existants + 3 nouveaux

- [x] **Step 4 : Commit**

```bash
git add apps/backend/src/competitions/services/competition-query.service.ts apps/backend/src/competitions/services/competition-query.service.spec.ts
git commit -m "feat(competitions): move getPendingRegistrationsForClub to CompetitionQueryService"
```

---

### Task 4 : Mettre à jour module et controller

**Files:**

- Modify: `apps/backend/src/competitions/competitions.module.ts`
- Modify: `apps/backend/src/competitions/competitions.controller.ts`
- Modify: `apps/backend/src/competitions/competitions.controller.spec.ts` (si nécessaire)

- [x] **Step 1 : Mettre à jour competitions.module.ts**

Dans `apps/backend/src/competitions/competitions.module.ts`, ajouter l'import :

```typescript
import { RegistrationNotificationService } from './services/registration-notification.service';
```

Ajouter `RegistrationNotificationService` dans le tableau `providers` :

```typescript
providers: [
  CompetitionManagementService,
  CompetitionQueryService,
  CompetitionRegistrationService,
  CompetitionResultsService,
  CompetitionCacheService,
  CompetitionSyncService,
  RegistrationNotificationService,
  LiveGateway,
  SyncProcessor,
],
```

`NotificationsService` n'est PAS dans les providers du module — il est fourni par un autre module. Vérifier que `NotificationsModule` (ou équivalent) est importé, ou que `NotificationsService` est global. Si ce n'est pas le cas, ajouter l'import du module approprié.

- [x] **Step 2 : Mettre à jour competitions.controller.ts**

Dans `apps/backend/src/competitions/competitions.controller.ts`, l'appel `this.registrationService.getPendingRegistrationsForClub(...)` doit être remplacé par `this.queryService.getPendingRegistrationsForClub(...)`.

Trouver la ligne (environ ligne 196) :

```typescript
return this.registrationService.getPendingRegistrationsForClub(req.user.userId);
```

Remplacer par :

```typescript
return this.queryService.getPendingRegistrationsForClub(req.user.userId);
```

- [x] **Step 3 : Vérifier toute la suite de tests**

```bash
cd apps/backend && npx jest --no-coverage 2>&1 | tail -8
```

Expected: All suites pass

- [x] **Step 4 : TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep -v "@ffd-connect/shared" | head -20
```

Expected: Aucune erreur nouvelle

- [x] **Step 5 : Commit**

```bash
git add apps/backend/src/competitions/competitions.module.ts apps/backend/src/competitions/competitions.controller.ts
git commit -m "refactor(competitions): wire RegistrationNotificationService in module and controller"
```
