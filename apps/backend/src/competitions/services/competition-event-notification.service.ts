import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, UserRole } from "@prisma/client";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage, getErrorStack } from "../../utils/error.utils";

/** Payload `kind` discriminator stored in Notification.data. */
export const NEW_COMPETITION_KIND = "NEW_COMPETITION";
export const RESULTS_KIND = "RESULTS";

/** Épreuve d'une compétition, réduite aux champs d'éligibilité. */
export interface EligibilityEvent {
  category: string | null;
  level: string | null;
  ageGroup: string | null;
}

/** Compétition + épreuves passée à notifyNewCompetition. */
export interface CompetitionWithEvents {
  id: string;
  title: string;
  location?: string | null;
  date?: Date | null;
  events: EligibilityEvent[];
}

/** Profil licencié réduit aux champs d'éligibilité. */
interface LicenseeProfile {
  id: string;
  category: string | null;
  competitionLevel: string | null;
  ageGroup: string | null;
}

/**
 * Notifications déclenchées par la synchro FFD :
 *  - « Nouvelle compétition » → licenciés éligibles (profil ⊆ au moins une épreuve).
 *  - « Résultats disponibles » → participants inscrits à la compétition.
 *
 * Idempotence : garde par requête sur Notification.data (competitionId + kind),
 * aucune migration nécessaire. Chaque notification métier ne part qu'une fois.
 * Toute erreur est avalée (try/catch + log) pour ne jamais casser la synchro.
 */
@Injectable()
export class CompetitionEventNotificationService {
  private readonly logger = new Logger(
    CompetitionEventNotificationService.name,
  );
  // Bornes de sécurité : évite d'inonder la base sur une compétition ouverte
  // qui matcherait un très grand nombre de profils / participants.
  private readonly MAX_RECIPIENTS = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Vrai si le profil du licencié correspond à l'épreuve (champ vide = joker). */
  private matchesEvent(
    profile: LicenseeProfile,
    event: EligibilityEvent,
  ): boolean {
    const norm = (s: string | null | undefined) =>
      s?.trim().toLowerCase() ?? "";
    const categoryOk =
      !profile.category || norm(event.category) === norm(profile.category);
    const levelOk =
      !profile.competitionLevel ||
      norm(event.level) === norm(profile.competitionLevel);
    const ageGroupOk =
      !profile.ageGroup || norm(event.ageGroup) === norm(profile.ageGroup);
    return categoryOk && levelOk && ageGroupOk;
  }

  /**
   * Notifie les licenciés éligibles de l'ouverture d'une nouvelle compétition.
   * N'envoie qu'une fois par compétition (garde sur data.competitionId + kind).
   */
  async notifyNewCompetition(
    competition: CompetitionWithEvents,
  ): Promise<void> {
    try {
      if (competition.events.length === 0) return;

      if (await this.alreadyNotified(competition.id, NEW_COMPETITION_KIND)) {
        return;
      }

      const licensees = await this.prisma.user.findMany({
        where: { role: UserRole.LICENSEE },
        select: {
          id: true,
          category: true,
          competitionLevel: true,
          ageGroup: true,
        },
        take: this.MAX_RECIPIENTS,
      });

      const eligibleIds = licensees
        .filter((u) =>
          competition.events.some((event) => this.matchesEvent(u, event)),
        )
        .map((u) => u.id);

      if (eligibleIds.length === 0) return;

      const title = "Nouvelle compétition";
      const parts = [`«${competition.title}» est ouverte.`];
      if (competition.location) parts.push(competition.location);
      if (competition.date) {
        parts.push(competition.date.toISOString().slice(0, 10));
      }
      const body = parts.join(" — ");

      // Push : l'éligibilité a DÉJÀ été calculée ci-dessus (discipline, niveau,
      // classe d'âge). Ce n'est donc pas une diffusion générale mais une
      // notification personnelle — d'où le défaut passé à ON dans le catalogue.
      await this.notificationsService.sendToUsers(
        eligibleIds,
        NotificationType.NEW_COMPETITION,
        title,
        body,
        {
          competitionId: competition.id,
          kind: NEW_COMPETITION_KIND,
        },
      );

      this.logger.log(
        `Notified ${eligibleIds.length} eligible licensees for new competition ${competition.id}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `notifyNewCompetition failed for ${competition.id}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
    }
  }

  /**
   * Notifie les participants (users inscrits à la compétition) de la
   * publication des résultats. N'envoie qu'une fois par compétition.
   */
  async notifyResultsPublished(competitionId: string): Promise<void> {
    try {
      if (await this.alreadyNotified(competitionId, RESULTS_KIND)) {
        return;
      }

      const competition = await this.prisma.competition.findUnique({
        where: { id: competitionId },
        select: { id: true, title: true },
      });
      if (!competition) return;

      const registrations = await this.prisma.registration.findMany({
        where: { event: { competitionId } },
        select: { userId: true },
        take: this.MAX_RECIPIENTS,
      });

      const participantIds = [...new Set(registrations.map((r) => r.userId))];
      if (participantIds.length === 0) return;

      const title = "Résultats disponibles";
      const body = `Les résultats de «${competition.title}» sont disponibles.`;

      // Push : ne touche que ceux qui ont dansé, et c'est ce qu'ils attendent.
      await this.notificationsService.sendToUsers(
        participantIds,
        NotificationType.COMPETITION_RESULTS,
        title,
        body,
        {
          competitionId,
          kind: RESULTS_KIND,
        },
      );

      this.logger.log(
        `Notified ${participantIds.length} participants of results for competition ${competitionId}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `notifyResultsPublished failed for ${competitionId}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
    }
  }

  /**
   * Garde d'idempotence : une notification existe-t-elle déjà pour ce couple
   * (competitionId, kind) ? Évite de renvoyer à chaque passage de la synchro.
   */
  private async alreadyNotified(
    competitionId: string,
    kind: string,
  ): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        data: {
          path: ["competitionId"],
          equals: competitionId,
        },
        AND: {
          data: {
            path: ["kind"],
            equals: kind,
          },
        },
      },
      select: { id: true },
    });
    return existing !== null;
  }
}
