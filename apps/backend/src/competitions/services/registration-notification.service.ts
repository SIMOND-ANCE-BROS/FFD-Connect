import { Injectable } from "@nestjs/common";
import { NotificationType, RegistrationStatus, UserRole } from "@prisma/client";
import { withActiveRole } from "../../auth/roles";
import { disciplineLabel } from "../../common/competition-level";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";

/** « Latines Adulte » : discipline en français + classe d'âge. */
export function eventDisplayLabel(event: {
  category: string | null;
  ageGroup: string | null;
}): string {
  return `${disciplineLabel(event.category)} ${event.ageGroup ?? ""}`.trim();
}

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

type MemberRef =
  | {
      firstName: string | null;
      lastName: string | null;
      clubId: string | null;
      clubName: string | null;
    }
  | null
  | undefined;

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
    const eventLabel = eventDisplayLabel(event);
    const { byOrganizer, initialStatus } = options;

    if (byOrganizer) {
      // Push : le licencié apprend qu'on l'a inscrit sans qu'il l'ait demandé.
      await this.notificationsService.sendToUser(
        registration.userId,
        NotificationType.REGISTRATION_STATUS,
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
      // Push : décision prise par le club sur son inscription.
      await this.notificationsService.sendToUser(
        registration.userId,
        NotificationType.REGISTRATION_STATUS,
        "Inscription validée",
        `Votre inscription à "${compTitle}" - ${eventLabel} est confirmée.`,
        {
          type: "registration_auto_confirmed",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
      await this.notifyClubOrganizers(
        member,
        event.competitionId,
        event.id,
        registration.id,
        {
          type: "club_member_auto_registered",
          title: "Inscription d'un licencié",
          body: `${memberName} s'est inscrit à "${compTitle}" - ${eventLabel}.`,
        },
      );
    } else {
      await this.notificationsService.createForUser(
        registration.userId,
        NotificationType.REGISTRATION_STATUS,
        "Inscription en attente",
        `Votre inscription à "${compTitle}" - ${eventLabel} est en attente de validation par votre club.`,
        {
          type: "registration_pending",
          competitionId: event.competitionId,
          eventId: event.id,
          registrationId: registration.id,
        },
      );
      await this.notifyClubOrganizers(
        member,
        event.competitionId,
        event.id,
        registration.id,
        {
          type: "club_member_pending_registration",
          title: "Inscription en attente de validation",
          body: `${memberName} a une inscription en attente pour "${compTitle}" - ${eventLabel}.`,
        },
      );
    }
  }

  async notifyOnUnregister(
    registration: RegistrationRef,
    event: EventRef,
    member: MemberRef,
    options: UnregisterNotifyOptions,
  ): Promise<void> {
    const compTitle = event.competition.title;
    const eventLabel = eventDisplayLabel(event);

    if (
      options.byOrganizer &&
      options.organizerUserId &&
      options.organizerUserId !== registration.userId
    ) {
      const wasPending = registration.status === RegistrationStatus.PENDING;
      // Push : c'est LA notification à ne pas manquer — un refus ou une
      // désinscription peut faire rater la compétition.
      await this.notificationsService.sendToUser(
        registration.userId,
        NotificationType.REGISTRATION_STATUS,
        wasPending
          ? "Inscription refusée par le club"
          : "Désinscription par le club",
        wasPending
          ? `Votre inscription à "${compTitle}" - ${eventLabel} n'a pas été validée par le club.`
          : `Le club vous a désinscrit de "${compTitle}" - ${eventLabel}.`,
        {
          type: wasPending
            ? "registration_refused_by_club"
            : "unregistration_by_club",
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
      await this.notifyClubOrganizers(
        member,
        event.competitionId,
        event.id,
        registration.id,
        {
          type: "club_member_unregistered",
          title: "Désinscription d'un licencié",
          body: `${memberName} s'est désinscrit de "${compTitle}" - ${eventLabel}.`,
        },
      );
    }
  }

  /**
   * Validation de l'inscription par le club.
   *
   * Seul producteur branché sur `sendToUser` (push + feed in-app) : c'est le
   * moment où la notification a le plus de valeur hors de l'application — le
   * licencié n'est pas devant son écran, il attend la décision de son club.
   * Les autres producteurs restent sur `createForUser` (feed in-app seul) le
   * temps de valider la chaîne de bout en bout.
   *
   * `sendToUser` est best-effort côté push : un échec FCM, un circuit ouvert ou
   * un timeout ne remonte pas ici et ne peut donc pas faire échouer la
   * validation de l'inscription (déjà committée par l'appelant).
   */
  async notifyOnConfirm(
    registration: RegistrationRef,
    event: EventRef,
  ): Promise<void> {
    const compTitle = event.competition.title;
    const eventLabel = eventDisplayLabel(event);

    await this.notificationsService.sendToUser(
      registration.userId,
      NotificationType.REGISTRATION_STATUS,
      "Inscription validée par le club",
      `Votre inscription à "${compTitle}" - ${eventLabel} a été validée par le club.`,
      {
        type: "registration_confirmed_by_club",
        competitionId: event.competitionId,
        eventId: event.id,
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
      where: { AND: [withActiveRole(UserRole.CLUB), sameClubCondition] },
      select: { id: true },
      take: 50,
    });

    const data: Record<string, string> = {
      type: notification.type,
      competitionId,
      eventId,
      registrationId,
    };

    // Push, mais le type reste à OFF par défaut dans le catalogue : elle se
    // déclenche sur l'activité d'AUTRUI, donc en rafale. Un gestionnaire qui la
    // veut l'active ; sinon la cloche suffit.
    await this.notificationsService.sendToUsers(
      organizers.map((organizer) => organizer.id),
      NotificationType.CLUB_MEMBER_REGISTRATION,
      notification.title,
      notification.body,
      data,
    );
  }
}
