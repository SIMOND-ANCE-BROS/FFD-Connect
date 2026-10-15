import { Injectable, Logger } from "@nestjs/common";
import { LicenseRenewalDocumentType, Prisma } from "@prisma/client";
import { CompetitionCacheService } from "../competitions/services/competition-cache.service";
import {
  HEALTH_DATA_ACCESS_ROUTES,
  type HealthDataAccessActor,
} from "../health-data-access/dto/health-data-access-log.dto";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { licenseRenewalDocumentFileSelect } from "../utils/prisma-selects";
import {
  affectedResultCompetitionIds,
  buildAccountDeletionOperations,
  prepareAccountDeletion,
} from "./account-deletion.core";

/**
 * Borne de la lecture des documents de renouvellement à purger : un brouillon
 * porte au plus un document par type, quelques demandes par saison.
 */
export const MAX_RENEWAL_DOCUMENTS_TO_PURGE = 200;

/**
 * Droit à l'oubli (RGPD art. 17) : cœur de la suppression définitive d'un
 * compte, partagé par la suppression in-app (Apple 5.1.1(v)) et par la
 * suppression depuis le back-office admin. Aucune vérification d'autorisation
 * ici : l'appelant a déjà vérifié le mot de passe (self-service) ou le rôle
 * ADMIN + l'email recopié (back-office).
 *
 * Les opérations de la transaction viennent de buildAccountDeletionOperations
 * (account-deletion.core.ts), partagée avec la purge des comptes de test en
 * staging (#412) : une seule liste des relations supprimées / anonymisées.
 *
 * Cascades Prisma (schéma) : refreshTokens, passwordResetTokens,
 * deviceTokens, notificationPrefs, partnerships, soloTeamMemberships,
 * licenseRenewalRequests (et leurs licenseRenewalDocuments).
 * SetNull : licence (reste propriété fédération), tracks soumis,
 * propositions de correction de musiques (auteur ET relecteur).
 * Propositions de correction de l'utilisateur : commentaire libre effacé
 * explicitement (texte potentiellement identifiant) ; les valeurs proposées
 * (titre, MPM…) portent sur la musique, pas sur la personne, et restent.
 * Inscriptions d'autrui en tant que partenaire : anonymisées explicitement
 * (partnerUserId ET partnerName, copie du nom complet → null ; null est
 * déjà géré partout à l'affichage).
 * Copies du nom sans identifiant (#395) : inscription du partenaire créée
 * par l'import sans partnerUserId, libellé d'un résultat de couple rattaché
 * au partenaire — cf. buildPartnerNameScrubOps (partner-name-scrub.ts).
 * Notifications reçues par d'autres (gestionnaires de club, #423) qui
 * nomment l'utilisateur : conservées dans le fil de leur destinataire, nom
 * remplacé par « Membre supprimé » / « Partenaire supprimé », retrouvées par
 * l'inscription ou le partenariat lié — cf. buildNotificationNameScrubOps
 * (notification-name-scrub.ts).
 * Suppressions explicites (FK sans onDelete → RESTRICT) : registrations,
 * seatBookings, notifications ; bugReports (userId sans FK).
 * Résultats de compétition (Result.userId sans FK, #382) : ANONYMISÉS, pas
 * supprimés. Une ligne est le classement d'un couple dans une épreuve ; la
 * supprimer créerait un trou dans le classement publié des autres couples.
 * userId → DELETED_USER_ID (sentinelle, la colonne reste NOT NULL) et details réduit aux clés non identifiantes (le nom du
 * couple, le dossard et le club partent) : la ligne ne permet plus de
 * réidentifier la personne. Le cache Redis des résultats des compétitions
 * concernées est invalidé après la transaction (best-effort, TTL 1 h sinon).
 * Journal admin : les lignes qui visent l'utilisateur sont CONSERVÉES mais
 * anonymisées (before/after mis à NULL, seuls action, auteur, date et
 * targetId — un UUID — restent), pour qu'un admin ne puisse pas effacer la
 * trace de ses actions en supprimant le compte.
 * ImpersonationLog est conservé (piste d'audit).
 *
 * Fichiers des documents de renouvellement (certificat médical — donnée de
 * santé, RGPD art. 9 — et certificat de licence) : leurs références sont
 * lues AVANT la transaction (la cascade efface les lignes), puis les
 * fichiers sont supprimés APRÈS son succès (en parallèle). Cette purge est
 * best-effort : un échec n'annule pas la suppression du compte (déjà
 * effective en base) ; il est remonté en erreur + Sentry (référence du
 * fichier uniquement) pour nettoyage manuel (RenewalDocumentFileCleaner).
 *
 * Journal des accès aux données de santé (#63) : la suppression de chaque
 * certificat médical y est tracée (titulaire, auteur, route), dans la même
 * transaction. Ces lignes, sans clé étrangère ni contenu, survivent à la
 * suppression du compte jusqu'à la fin de leur rétention (1 an).
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renewalDocumentFiles: RenewalDocumentFileCleaner,
    private readonly competitionCache: CompetitionCacheService,
    private readonly healthAccess: HealthDataAccessLogService,
  ) {}

  /**
   * @param alsoInTransaction operations appended to the same transaction,
   *   after the user row is deleted (the admin path adds its audit row here,
   *   so it survives the purge of rows that target the user).
   * @param actor who deletes, for the health-data access journal (#63):
   *   the account holder by default, the administrator on the admin path.
   */
  async deleteAccount(
    userId: string,
    alsoInTransaction: Prisma.PrismaPromise<unknown>[] = [],
    actor: HealthDataAccessActor = {
      actorUserId: userId,
      actorRole: "OWNER",
      route: HEALTH_DATA_ACCESS_ROUTES.selfAccountDeletion,
    },
  ): Promise<void> {
    const documents = await this.prisma.licenseRenewalDocument.findMany({
      where: { request: { userId } },
      select: licenseRenewalDocumentFileSelect,
      take: MAX_RENEWAL_DOCUMENTS_TO_PURGE,
    });
    if (documents.length === MAX_RENEWAL_DOCUMENTS_TO_PURGE) {
      // Plafond atteint : des fichiers au-delà resteraient orphelins en
      // stockage. Pas d'identifiant utilisateur dans le log.
      this.logger.warn(
        `Account deletion: renewal document read hit the ${MAX_RENEWAL_DOCUMENTS_TO_PURGE} cap — remaining files may be orphaned, run scripts/list-orphan-renewal-blobs.ts`,
      );
    }
    const certificates = documents.filter(
      (d) => d.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    const plan = await prepareAccountDeletion(this.prisma, userId, this.logger);
    await this.prisma.$transaction([
      ...buildAccountDeletionOperations(this.prisma, userId, plan),
      ...alsoInTransaction,
      ...(certificates.length > 0
        ? [
            this.healthAccess.recordOp(
              certificates.map((d) => ({
                ...actor,
                subjectUserId: userId,
                action: "DELETE" as const,
                resourceType: "MEDICAL_CERTIFICATE" as const,
                resourceId: d.id,
              })),
            ),
          ]
        : []),
    ]);
    await this.renewalDocumentFiles.deleteFiles(
      documents.map((d) => d.filePath),
      "account-deletion",
    );
    await this.invalidateResultCaches(affectedResultCompetitionIds(plan));
  }

  /** Best-effort : un échec Redis n'annule pas une suppression déjà faite. */
  private async invalidateResultCaches(
    competitionIds: string[],
  ): Promise<void> {
    const outcomes = await Promise.allSettled(
      competitionIds.map((id) => this.competitionCache.invalidateResults(id)),
    );
    const failed = outcomes.filter((o) => o.status === "rejected").length;
    if (failed > 0) {
      this.logger.warn(
        `Account deletion: ${failed} results cache invalidation(s) failed — stale results expire with the cache TTL`,
      );
    }
  }
}
