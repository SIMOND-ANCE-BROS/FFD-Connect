import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CompetitionCacheService } from "../competitions/services/competition-cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import {
  licenseRenewalDocumentFileSelect,
  resultAnonymizationSelect,
} from "../utils/prisma-selects";
import { buildPartnerNameScrubOps } from "./partner-name-scrub";

/**
 * Borne de la lecture des documents de renouvellement à purger : un brouillon
 * porte au plus un document par type, quelques demandes par saison.
 */
export const MAX_RENEWAL_DOCUMENTS_TO_PURGE = 200;

/**
 * Borne de la lecture des résultats à anonymiser (un résultat par épreuve
 * finale, quelques dizaines par saison). Au-delà, le filet `updateMany` de la
 * transaction anonymise quand même le reste (details vidé).
 */
export const MAX_RESULTS_TO_ANONYMIZE = 1000;

/**
 * Valeur sentinelle de `Result.userId` pour un résultat anonymisé (#382) :
 * l'UUID nul, jamais attribué à un compte (User.id = uuid v4 aléatoire), donc
 * jamais renvoyé par une requête « résultats de l'utilisateur X ».
 * La colonne reste NOT NULL exprès : le client Prisma d'une image antérieure
 * (rollback automatique du déploiement) lit `userId` comme `String` requis et
 * planterait sur un NULL. Reprise des comptes supprimés avant le correctif :
 * migration 20261012130000_result_anonymize_deleted_users.
 */
export const DELETED_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Clés de `Result.details` (JSON libre d'import) conservées à l'anonymisation :
 * elles décrivent l'épreuve ou la prestation, pas la personne. Tout le reste
 * part — `participant` (nom du couple), `name`, `bib` (dossard), `club` et
 * toute clé inconnue : liste blanche plutôt que liste noire.
 */
export const ANONYMIZED_RESULT_DETAIL_KEYS = [
  "totalParticipants",
  "status",
  "marks",
] as const;

/**
 * Réduit `details` aux clés non identifiantes. Toujours un objet (jamais
 * null) : l'écran des résultats en direct lit `details.participant` sans
 * garde et retombe alors sur son libellé générique.
 */
export function anonymizeResultDetails(
  details: Prisma.JsonValue,
): Prisma.InputJsonObject {
  const kept: Record<string, Prisma.InputJsonValue> = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const key of ANONYMIZED_RESULT_DETAIL_KEYS) {
      const value = details[key];
      if (value !== undefined && value !== null) kept[key] = value;
    }
  }
  return kept;
}

/**
 * Droit à l'oubli (RGPD art. 17) : cœur de la suppression définitive d'un
 * compte, partagé par la suppression in-app (Apple 5.1.1(v)) et par la
 * suppression depuis le back-office admin. Aucune vérification d'autorisation
 * ici : l'appelant a déjà vérifié le mot de passe (self-service) ou le rôle
 * ADMIN + l'email recopié (back-office).
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
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renewalDocumentFiles: RenewalDocumentFileCleaner,
    private readonly competitionCache: CompetitionCacheService,
  ) {}

  /**
   * @param alsoInTransaction operations appended to the same transaction,
   *   after the user row is deleted (the admin path adds its audit row here,
   *   so it survives the purge of rows that target the user).
   */
  async deleteAccount(
    userId: string,
    alsoInTransaction: Prisma.PrismaPromise<unknown>[] = [],
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
    // Read before the transaction: it deletes the user's own registrations,
    // which locate the couple (event + bib).
    const partnerNameScrub = await buildPartnerNameScrubOps(
      this.prisma,
      userId,
      this.logger,
    );
    const results = await this.prisma.result.findMany({
      where: { userId },
      select: resultAnonymizationSelect,
      take: MAX_RESULTS_TO_ANONYMIZE,
    });
    await this.prisma.$transaction([
      // Résultats : anonymisés ligne par ligne (details réduit), puis un filet
      // pour ceux au-delà de la borne ou créés entre-temps : aucune ligne ne
      // garde l'ancien userId à la sortie de la transaction.
      ...results.map((r) =>
        this.prisma.result.update({
          where: { id: r.id },
          data: {
            userId: DELETED_USER_ID,
            details: anonymizeResultDetails(r.details),
          },
        }),
      ),
      this.prisma.result.updateMany({
        where: { userId },
        data: { userId: DELETED_USER_ID, details: {} },
      }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.seatBooking.deleteMany({ where: { userId } }),
      this.prisma.registration.deleteMany({ where: { userId } }),
      // Inscriptions d'autrui où l'utilisateur est partenaire : la FK passerait
      // en SetNull, mais partnerName garde une copie de son nom complet.
      this.prisma.registration.updateMany({
        where: { partnerUserId: userId },
        data: { partnerUserId: null, partnerName: null },
      }),
      ...partnerNameScrub.ops,
      // Le SetNull de proposedById laisserait le commentaire libre, qui peut
      // identifier son auteur : il est effacé avant la suppression du compte.
      this.prisma.trackCorrection.updateMany({
        where: { proposedById: userId },
        data: { message: null },
      }),
      // BugReport.userId n'a pas de FK (report.prisma) : suppression explicite.
      this.prisma.bugReport.deleteMany({ where: { userId } }),
      // Keep the audit trail but strip what may identify the person (before /
      // after hold names, emails...). Must run before the caller's own ops so
      // the USER_DELETE row appended below keeps its { role }. Rows the user
      // authored as an admin stay (actorId -> SetNull).
      this.prisma.adminAuditLog.updateMany({
        where: { targetType: "USER", targetId: userId },
        data: { before: Prisma.DbNull, after: Prisma.DbNull },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
      ...alsoInTransaction,
    ]);
    await this.renewalDocumentFiles.deleteFiles(
      documents.map((d) => d.filePath),
      "account-deletion",
    );
    await this.invalidateResultCaches([
      ...results.map((r) => r.event.competitionId),
      // Couple results of the partner whose label was scrubbed (#395).
      ...partnerNameScrub.competitionIds,
    ]);
  }

  /** Best-effort : un échec Redis n'annule pas une suppression déjà faite. */
  private async invalidateResultCaches(
    affectedCompetitionIds: string[],
  ): Promise<void> {
    const competitionIds = [...new Set(affectedCompetitionIds)];
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
