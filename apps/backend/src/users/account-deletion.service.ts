import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { licenseRenewalDocumentFileSelect } from "../utils/prisma-selects";

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
 * Suppressions explicites (FK sans onDelete → RESTRICT) : registrations,
 * seatBookings, notifications ; bugReports (userId sans FK) ; lignes du
 * journal admin qui visent l'utilisateur.
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
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.seatBooking.deleteMany({ where: { userId } }),
      this.prisma.registration.deleteMany({ where: { userId } }),
      // Inscriptions d'autrui où l'utilisateur est partenaire : la FK passerait
      // en SetNull, mais partnerName garde une copie de son nom complet.
      this.prisma.registration.updateMany({
        where: { partnerUserId: userId },
        data: { partnerUserId: null, partnerName: null },
      }),
      // Le SetNull de proposedById laisserait le commentaire libre, qui peut
      // identifier son auteur : il est effacé avant la suppression du compte.
      this.prisma.trackCorrection.updateMany({
        where: { proposedById: userId },
        data: { message: null },
      }),
      // BugReport.userId n'a pas de FK (report.prisma) : suppression explicite.
      this.prisma.bugReport.deleteMany({ where: { userId } }),
      // Back-office audit rows about this person would outlive the account.
      // Rows the user authored as an admin stay (actorId -> SetNull).
      this.prisma.adminAuditLog.deleteMany({
        where: { targetType: "USER", targetId: userId },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
      ...alsoInTransaction,
    ]);
    await this.renewalDocumentFiles.deleteFiles(
      documents.map((d) => d.filePath),
      "account-deletion",
    );
  }
}
