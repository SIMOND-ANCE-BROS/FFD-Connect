import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, UserRole } from "@prisma/client";
import { withActiveRole } from "../../auth/roles";
import {
  getCompetitionLevelForCategory,
  normalizeDiscipline,
  practisesDiscipline,
  type CompetitionLevelProfile,
} from "../../common/competition-level";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage, getErrorStack } from "../../utils/error.utils";
import {
  competitionResultsNotificationSelect,
  idOnlySelect,
  resultOwnerSelect,
  userEligibilityProfileSelect,
} from "../../utils/prisma-selects";

/** Payload `kind` discriminator stored in Notification.data. */
export const NEW_COMPETITION_KIND = "NEW_COMPETITION";
export const RESULTS_KIND = "RESULTS";

/**
 * « Résultats disponibles » waits until a result row has existed this long
 * (#713): an import undone within the grace period (wrong file, deleted
 * right away) notifies nobody.
 */
export const RESULTS_NOTIFICATION_GRACE_MS = 15 * 60_000;

/** Results created longer ago than this are no longer looked at (#713). */
export const PENDING_RESULTS_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** Upper bound of the competitions handled by one pending-results pass. */
export const MAX_PENDING_RESULTS_COMPETITIONS = 100;

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
interface LicenseeProfile extends CompetitionLevelProfile {
  id: string;
  ageGroup: string | null;
}

/**
 * Notifications déclenchées par la synchro FFD :
 *  - « Nouvelle compétition » → licenciés éligibles (profil ⊆ au moins une épreuve).
 *  - « Résultats disponibles » → participants inscrits à la compétition et
 *    comptes rattachés à un résultat importé (#652).
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

  /**
   * Vrai si le profil du licencié correspond à l'épreuve (champ vide = joker).
   * Discipline : le licencié la pratique (10 danses = Latines ET Standards).
   * Niveau : celui du licencié DANS LA DISCIPLINE de l'épreuve ; aucune
   * condition de niveau pour les 10 danses.
   */
  private matchesEvent(
    profile: LicenseeProfile,
    event: EligibilityEvent,
  ): boolean {
    const norm = (s: string | null | undefined) =>
      s?.trim().toLowerCase() ?? "";
    const categoryOk =
      !event.category || practisesDiscipline(profile, event.category) !== false;
    const profileLevel = getCompetitionLevelForCategory(
      profile,
      event.category,
    );
    const levelOk =
      normalizeDiscipline(event.category) === "Ten Dance" ||
      !profileLevel ||
      norm(event.level) === norm(profileLevel);
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
        where: withActiveRole(UserRole.LICENSEE),
        select: { id: true, ...userEligibilityProfileSelect },
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
   * Notifie les participants de la publication des résultats : inscrits à la
   * compétition et comptes rattachés à un résultat importé (#652, titulaire
   * ou second membre du couple). N'envoie qu'une fois par compétition :
   * l'envoi est réservé par une mise à jour conditionnelle de
   * `Competition.resultsNotifiedAt` (deux imports simultanés ne peuvent pas
   * l'obtenir tous les deux), libérée si l'envoi échoue. Sans destinataire,
   * rien n'est réservé : un import suivant qui rattache des comptes notifie.
   *
   * Délai de grâce (#713) : rien ne part tant qu'aucun résultat de la
   * compétition n'existe depuis RESULTS_NOTIFICATION_GRACE_MS. Un import
   * supprimé avant ne notifie donc personne ; un import qui reste est notifié
   * par le passage suivant de `notifySettledResults`.
   */
  async notifyResultsPublished(
    competitionId: string,
    now: Date = new Date(),
  ): Promise<void> {
    try {
      // Competitions notified before the reservation column existed.
      if (await this.alreadyNotified(competitionId, RESULTS_KIND)) {
        return;
      }

      const competition = await this.prisma.competition.findUnique({
        where: { id: competitionId },
        select: competitionResultsNotificationSelect,
      });
      if (!competition || competition.resultsNotifiedAt) return;

      const settled = await this.prisma.result.findFirst({
        where: {
          event: { competitionId },
          createdAt: { lte: settledBefore(now) },
        },
        select: idOnlySelect,
      });
      if (!settled) return;

      const participantIds = await this.resultsRecipients(competitionId);
      if (participantIds.length === 0) return;

      const claimedAt = new Date();
      const claim = await this.prisma.competition.updateMany({
        where: { id: competitionId, resultsNotifiedAt: null },
        data: { resultsNotifiedAt: claimedAt },
      });
      if (claim.count === 0) return; // another import sent it

      const title = "Résultats disponibles";
      const body = `Les résultats de «${competition.title}» sont disponibles.`;

      try {
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
      } catch (error: unknown) {
        // Nothing reached the feed: free the reservation for a later import.
        await this.prisma.competition.updateMany({
          where: { id: competitionId, resultsNotifiedAt: claimedAt },
          data: { resultsNotifiedAt: null },
        });
        throw error;
      }

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
   * Passage périodique (#713) : notifie les compétitions dont un résultat a
   * passé le délai de grâce et qui n'ont pas encore été notifiées. Seuls les
   * résultats créés dans la fenêtre PENDING_RESULTS_WINDOW_MS sont regardés
   * (une compétition sans destinataire n'est pas réservée : elle cesse d'être
   * regardée au bout de la fenêtre). Retourne le nombre de compétitions vues.
   */
  async notifySettledResults(now: Date = new Date()): Promise<number> {
    const pending = await this.prisma.competition.findMany({
      where: {
        resultsNotifiedAt: null,
        events: {
          some: {
            results: {
              some: {
                createdAt: {
                  gte: new Date(now.getTime() - PENDING_RESULTS_WINDOW_MS),
                  lte: settledBefore(now),
                },
              },
            },
          },
        },
      },
      select: idOnlySelect,
      orderBy: { date: "desc" },
      take: MAX_PENDING_RESULTS_COMPETITIONS,
    });
    for (const { id } of pending) {
      await this.notifyResultsPublished(id, now);
    }
    return pending.length;
  }

  /**
   * Inscrits + comptes rattachés aux résultats. `Result.userId` /
   * `partnerUserId` n'ont pas de clé étrangère (sentinelle de suppression,
   * marqueur « non rattaché ») : seuls les comptes existants sont gardés.
   */
  private async resultsRecipients(competitionId: string): Promise<string[]> {
    const [registrations, owners] = await Promise.all([
      this.prisma.registration.findMany({
        where: { event: { competitionId } },
        select: { userId: true },
        take: this.MAX_RECIPIENTS,
      }),
      this.prisma.result.findMany({
        where: { event: { competitionId } },
        select: resultOwnerSelect,
        take: this.MAX_RECIPIENTS,
      }),
    ]);
    const ownerIds = [
      ...new Set(
        owners.flatMap((o) =>
          o.partnerUserId ? [o.userId, o.partnerUserId] : [o.userId],
        ),
      ),
    ];
    const ownerAccounts =
      ownerIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: ownerIds } },
            select: idOnlySelect,
            take: this.MAX_RECIPIENTS,
          });
    return [
      ...new Set([
        ...registrations.map((r) => r.userId),
        ...ownerAccounts.map((u) => u.id),
      ]),
    ];
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

/** Results created at or before this instant have passed the grace period. */
function settledBefore(now: Date): Date {
  return new Date(now.getTime() - RESULTS_NOTIFICATION_GRACE_MS);
}
