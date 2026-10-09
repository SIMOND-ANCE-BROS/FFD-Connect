import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ClubRegistrationMode,
  EventType,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import {
  computeCoupleAgeGroup,
  computeSoloAgeGroup,
  ESPOIR_AGE_GROUP,
  ESPOIR_MAX_AGE,
  ESPOIR_MIN_AGE,
  getReferenceYear,
  isCoupleEspoirEligible,
} from "../../common/age-group";
import {
  disciplineLabel,
  getCompetitionLevelForCategory,
  normalizeDiscipline,
  practisesDiscipline,
} from "../../common/competition-level";
import { checkParticipationEligibility } from "../../common/participation-rules";
import { handlePrismaError } from "../../utils/prisma-errors.util";
import { hasRole } from "../../auth/roles";
import {
  competitionForRegistrationSelect,
  userEligibilityProfileSelect,
  userRolesClubSelect,
} from "../../utils/prisma-selects";

/** 10 danses : réservé aux danseurs des deux disciplines. */
export const TEN_DANCE_BOTH_DISCIPLINES_MESSAGE =
  "Les épreuves 10 danses sont réservées aux danseurs pratiquant les Latines et les Standards.";
import { PrismaService } from "../../prisma/prisma.service";
import { ClubsHelloAssoService } from "../../clubs/clubs-helloasso.service";
import { CompetitionCacheService } from "./competition-cache.service";
import { RegistrationNotificationService } from "./registration-notification.service";

/** Deadline shown to users in the federation's timezone, whatever the server TZ. */
const DEADLINE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  dateStyle: "long",
  timeStyle: "short",
});

/**
 * Registration closes once the deadline instant is over: registering exactly
 * at the deadline is still allowed (`now > deadline` rejects). The comparison
 * is on absolute instants (epoch ms), so the server timezone is irrelevant —
 * a client replaying a queued registration must use the same rule to agree.
 */
export function isRegistrationClosed(
  deadline: Date | null | undefined,
  now: Date = new Date(),
): deadline is Date {
  return deadline != null && now.getTime() > deadline.getTime();
}

export function registrationClosedMessage(deadline: Date): string {
  return `Les inscriptions à cette compétition sont closes depuis le ${DEADLINE_FORMATTER.format(deadline)}.`;
}

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
      include: { competition: { select: competitionForRegistrationSelect } },
    });

    if (!event) {
      throw new NotFoundException("Événement non trouvé");
    }

    // Épreuve couple : partenaire obligatoire. Épreuve solo : pas de partenaire.
    if (
      event.eventType === EventType.COUPLE &&
      !partnerName?.trim() &&
      !options.partnerUserId
    ) {
      throw new BadRequestException(
        "Cette épreuve est en couple. Indiquez le nom de votre partenaire (ou son compte licencié) pour vous inscrire.",
      );
    }
    if (
      event.eventType === EventType.SOLO &&
      (partnerName?.trim() || options.partnerUserId)
    ) {
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
      throw new ConflictException("Déjà inscrit à cet événement");
    }

    // Date limite d'inscription (#821). Checked after the duplicate check so an
    // idempotent replay of an already-accepted registration still gets 409
    // (the offline queue treats it as "already registered"). Applies to the
    // club path too (registerMember → register): no staff override exists.
    // 403 rather than 409 (reserved for duplicates) or 422 (the payload is
    // valid, the action is refused by a business rule — same as CLUB_ONLY).
    const deadline = event.competition.registrationDeadline;
    if (isRegistrationClosed(deadline)) {
      throw new ForbiddenException(registrationClosedMessage(deadline));
    }

    let initialStatus: RegistrationStatus = RegistrationStatus.PENDING;
    if (options.byOrganizer) {
      initialStatus = RegistrationStatus.CONFIRMED;
    } else {
      const mode =
        await this.clubsHelloAssoService.getRegistrationModeForUser(userId);
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
    const cat = (event.category || "").toLowerCase();
    const referenceYear = getReferenceYear(event.competition.date);

    // Calcul automatique de la classe d'âge (Article 5 FFDanse)
    let computedAgeGroup: string | null = null;
    const registrant = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true, ...userEligibilityProfileSelect },
    });
    // 10 danses : la personne inscrite doit pratiquer les deux disciplines
    // (aucune condition de niveau). Profil sans info de discipline : non bloquant.
    if (
      normalizeDiscipline(event.category) === "Ten Dance" &&
      practisesDiscipline(registrant, event.category) === false
    ) {
      throw new BadRequestException(TEN_DANCE_BOTH_DISCIPLINES_MESSAGE);
    }
    if (event.eventType === EventType.SOLO && registrant?.birthDate) {
      computedAgeGroup = computeSoloAgeGroup(
        registrant.birthDate,
        referenceYear,
      );
    }
    let partnerDisplayName: string | null = partnerName?.trim()
      ? partnerName.trim()
      : null;
    if (
      event.eventType === EventType.COUPLE &&
      registrant?.birthDate &&
      options.partnerUserId
    ) {
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
        if (
          event.ageGroup === ESPOIR_AGE_GROUP &&
          !isCoupleEspoirEligible(
            registrant.birthDate,
            partner.birthDate,
            referenceYear,
          )
        ) {
          throw new BadRequestException(
            `Les épreuves Espoir sont réservées aux couples de moins de 21 ans (partenaires de ${ESPOIR_MIN_AGE} à ${ESPOIR_MAX_AGE} ans au 31 décembre).`,
          );
        }
      }
      if (!partnerDisplayName && partner?.firstName != null) {
        partnerDisplayName = `${partner.firstName} ${partner.lastName}`.trim();
      }
    }

    const finalPartnerName =
      event.eventType === EventType.SOLO ? null : partnerDisplayName;
    const finalAgeGroup =
      computedAgeGroup ??
      (isCouple && options.coupleAgeGroup?.trim()
        ? options.coupleAgeGroup.trim()
        : null);

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
        // Niveau explicite, sinon celui du profil DANS LA DISCIPLINE de l'épreuve.
        registrantLevel: options.registrantLevel?.trim()
          ? options.registrantLevel.trim()
          : (getCompetitionLevelForCategory(registrant, event.category) ??
            undefined),
      });
      if (!eligibility.allowed) {
        throw new BadRequestException(
          eligibility.reason ??
            "Participation non autorisée pour cette épreuve.",
        );
      }
    }

    // Article 9 §1.2 : en majeures (championnat régional, coupe de France), une seule épreuve par spécialité
    if (competitionType === "MAJEURE" && eventKind === "MAJEURE") {
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
          `En compétition majeure, un couple ou solo ne peut participer qu'à une seule épreuve par spécialité (${disciplineLabel(event.category)}). Vous êtes déjà inscrit à une épreuve ${disciplineLabel(event.category)}.`,
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
            ? (options.coupleDisciplineLatin ??
              (cat === "latin" || cat === "ten dance"))
            : false,
          coupleDisciplineStandard: isCouple
            ? (options.coupleDisciplineStandard ??
              (cat === "standard" || cat === "ten dance"))
            : false,
        },
      })
      .catch((err) => handlePrismaError(err, "Registration"));

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

    await this.notificationService.notifyOnRegister(
      registration,
      event,
      member,
      { byOrganizer: options.byOrganizer ?? false, initialStatus },
    );

    return registration;
  }

  async confirmRegistration(registrationId: string, organizerUserId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: {
          include: {
            competition: { select: competitionForRegistrationSelect },
          },
        },
        user: { select: { id: true, clubId: true, clubName: true } },
      },
    });
    if (!registration) {
      throw new NotFoundException("Inscription non trouvée");
    }
    if (registration.status !== RegistrationStatus.PENDING) {
      throw new ConflictException(
        "Cette inscription n'est pas en attente de validation",
      );
    }

    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!organizer || !hasRole(organizer, UserRole.CLUB)) {
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
        "Vous ne pouvez valider que les inscriptions des membres de votre club",
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
      {
        id: registration.id,
        userId: registration.userId,
        eventId: registration.eventId,
      },
      registration.event,
    );

    return updated;
  }

  async unregister(
    eventId: string,
    userId: string,
    options: UnregisterOptions = {},
  ) {
    this.logger.log(`Unregistering user ${userId} from event ${eventId}`);

    const registration = await this.prisma.registration.findFirst({
      where: {
        eventId,
        userId,
        status: {
          in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
        },
      },
      include: {
        event: {
          include: {
            competition: { select: competitionForRegistrationSelect },
          },
        },
      },
    });

    if (!registration) {
      throw new NotFoundException("Inscription non trouvée");
    }

    const result = await this.prisma.registration.update({
      where: { id: registration.id },
      data: { status: RegistrationStatus.CANCELLED },
    });

    await this.cacheService.invalidateCompetition(
      registration.event.competitionId,
      userId,
    );

    const member =
      options.byOrganizer &&
      options.organizerUserId &&
      options.organizerUserId !== userId
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
    await this.ensureMemberBelongsToOrganizerClub(
      organizerUserId,
      memberUserId,
    );
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { competition: { select: competitionForRegistrationSelect } },
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

  private async ensureMemberBelongsToOrganizerClub(
    organizerUserId: string,
    memberUserId: string,
  ) {
    const [organizer, member] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: organizerUserId },
        select: userRolesClubSelect,
      }),
      this.prisma.user.findUnique({
        where: { id: memberUserId },
        select: { clubId: true, clubName: true },
      }),
    ]);
    if (!organizer || !hasRole(organizer, UserRole.CLUB)) {
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
}
