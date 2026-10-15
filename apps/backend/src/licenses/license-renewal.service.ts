import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { ParentalConsentQueryService } from "../parental-consent/parental-consent.query-service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { OcrService } from "../utils/ocr.service";
import {
  idOnlySelect,
  licenseRenewalRequestResponseSelect,
  licenseRenewalSubmitTargetSelect,
  licenseRenewalUploadTargetSelect,
  userLicenseValidUntilSelect,
} from "../utils/prisma-selects";
import { medicalCertificatePurgeDueAt } from "./medical-certificate-retention.util";
import { isLicenseCoveredForRenewal } from "./license-season";
import { LicenseRenewalNotificationService } from "./license-renewal-notification.service";
import { toLicenseQrExpiry } from "./qr/license-qr";
import {
  pickRenewalOcrData,
  RenewalOcrData,
  toRenewalRequestResponse,
} from "./renewal-ocr-data.util";

@Injectable()
export class LicenseRenewalService {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private blobStorage: BlobStorageService,
    private renewalDocumentFiles: RenewalDocumentFileCleaner,
    private renewalNotifications: LicenseRenewalNotificationService,
    private parentalConsent: ParentalConsentQueryService,
  ) {}

  /**
   * Crée ou récupère la demande de renouvellement en cours de l'utilisateur.
   *
   * Une seule demande PENDING par utilisateur (#271) : si une demande attend
   * déjà la décision d'un administrateur, c'est elle qui est renvoyée — pas de
   * nouveau brouillon qui s'empilerait dans la file de modération. Sinon le
   * brouillon existant est repris, ou un brouillon est créé.
   *
   * Lecture et création sous le verrou utilisateur (`lockUserRenewals`) : deux
   * démarrages simultanés ne créent pas deux brouillons.
   */
  async startRenewalRequest(userId: string) {
    const request = await this.prisma.$transaction(async (tx) => {
      await lockUserRenewals(tx, userId);
      const pending = await tx.licenseRenewalRequest.findFirst({
        where: { userId, status: LicenseRenewalStatus.PENDING },
        // Several PENDING may predate #271: the oldest heads the queue.
        orderBy: { createdAt: "asc" },
        select: licenseRenewalRequestResponseSelect,
      });
      if (pending) return pending;
      const draft = await tx.licenseRenewalRequest.findFirst({
        where: { userId, status: LicenseRenewalStatus.DRAFT },
        orderBy: { createdAt: "desc" },
        select: licenseRenewalRequestResponseSelect,
      });
      if (draft) return draft;
      return tx.licenseRenewalRequest.create({
        data: { userId, status: LicenseRenewalStatus.DRAFT },
        select: licenseRenewalRequestResponseSelect,
      });
    });
    return toRenewalRequestResponse(request);
  }

  /** Récupère la demande de renouvellement en cours (brouillon ou soumise) pour l'utilisateur. */
  async getMyRenewalRequest(userId: string) {
    // Same rule as `startRenewalRequest` (#271): the request awaiting a
    // decision comes first, even when a newer draft predates #271.
    const request =
      (await this.prisma.licenseRenewalRequest.findFirst({
        where: { userId, status: LicenseRenewalStatus.PENDING },
        orderBy: { createdAt: "asc" },
        select: licenseRenewalRequestResponseSelect,
      })) ??
      (await this.prisma.licenseRenewalRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: licenseRenewalRequestResponseSelect,
      }));
    return request ? toRenewalRequestResponse(request) : null;
  }

  /**
   * Ajoute un document à une demande de renouvellement et lance l'OCR selon le type.
   * Remplace tout document existant du même type pour cette demande.
   *
   * L'OCR ne refuse jamais le document (#271) : aptitude, date et numéro lus
   * sont conservés dans `ocrData` comme indices pour l'administrateur qui
   * décide. Un certificat illisible, ancien ou défavorable est donc archivé tel
   * quel, avec son échéance de purge.
   *
   * Le fichier est reçu en mémoire (buffer) : l'OCR lit directement les octets,
   * puis le document est archivé dans Azure Blob Storage (backend sans état). La
   * référence blob (`blobName`) est persistée dans le champ `filePath`.
   */
  async uploadRenewalDocument(
    userId: string,
    requestId: string,
    type: LicenseRenewalDocumentType,
    fileBuffer: Buffer,
    blobName: string,
  ) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { id: requestId, userId },
      select: licenseRenewalUploadTargetSelect,
    });
    if (!request)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    if (request.status !== LicenseRenewalStatus.DRAFT)
      throw new BadRequestException(
        "Seules les demandes en brouillon peuvent recevoir des documents",
      );
    // Health data of a minor: never received, not even read by the OCR,
    // without a parent's confirmed consent (#61, GDPR art. 8 / 9).
    if (type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      await this.parentalConsent.assertHealthDataAllowed(userId);
    }

    // Only the whitelisted fields are kept (#224): the OCR must not be able to
    // persist raw certificate text, whatever it returns.
    let ocrData: RenewalOcrData | null = null;
    if (type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      ocrData =
        pickRenewalOcrData(
          type,
          await this.ocrService.extractMedicalCertificateInfo(fileBuffer),
        ) ?? {};
    }
    if (type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE) {
      ocrData = pickRenewalOcrData(
        type,
        await this.ocrService.extractLicenseInfo(fileBuffer),
      );
    }

    // Les indices OCR lus, on archive le document dans Blob.
    // Si le stockage blob n'est pas configuré (tests, dev local), on conserve
    // simplement le nom de blob comme référence — aucune écriture disque.
    const storedReference = await this.persistDocument(blobName, fileBuffer);

    let replacedReferences: string[];
    try {
      // Remplacement atomique : si la création échoue, l'ancien document reste
      // en base (et son fichier est conservé).
      replacedReferences = await this.prisma.$transaction(async (tx) => {
        // Sous le verrou utilisateur, comme la soumission (#271) : l'OCR et
        // l'archivage ont pu durer, la demande a pu être soumise entre-temps.
        // Un document ne remplace jamais celui qu'un administrateur examine.
        await lockUserRenewals(tx, userId);
        const current = await tx.licenseRenewalRequest.findFirst({
          where: { id: requestId, userId },
          select: licenseRenewalUploadTargetSelect,
        });
        if (current?.status !== LicenseRenewalStatus.DRAFT)
          throw new BadRequestException(
            "Seules les demandes en brouillon peuvent recevoir des documents",
          );
        // Fichiers du document remplacé (même type) : lus sous le verrou,
        // supprimés une fois la nouvelle ligne enregistrée — sinon le
        // certificat médical précédent (RGPD art. 9) resterait orphelin.
        const replaced = current.documents
          .filter((d) => d.type === type && d.filePath !== storedReference)
          .map((d) => d.filePath);
        await tx.licenseRenewalDocument.deleteMany({
          where: { requestId, type },
        });
        await tx.licenseRenewalDocument.create({
          data: {
            requestId,
            type,
            filePath: storedReference,
            ocrData: ocrData ? { ...ocrData } : undefined,
            // Échéance de purge posée À L'ÉCRITURE (#62) : elle se déduit de la
            // date d'émission enfouie dans `ocrData`, que le SQL ne sait pas
            // lire. La stocker permet à la purge de filtrer exactement, au lieu
            // de ramener un lot approximatif et de trancher en mémoire.
            // Seuls les certificats médicaux sont concernés : le certificat de
            // licence relève d'une autre durée de conservation.
            purgeDueAt:
              type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE
                ? medicalCertificatePurgeDueAt({
                    createdAt: new Date(),
                    ocrData,
                  })
                : null,
          },
          select: idOnlySelect,
        });
        return replaced;
      });
    } catch (error) {
      // Le blob tout juste archivé n'est référencé par aucune ligne : on le
      // supprime (best-effort) avant de propager l'erreur.
      await this.renewalDocumentFiles.deleteFiles(
        [storedReference],
        "upload-rollback",
      );
      throw error;
    }

    await this.renewalDocumentFiles.deleteFiles(
      replacedReferences,
      "document-replaced",
    );

    const updated = await this.prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: licenseRenewalRequestResponseSelect,
    });
    return toRenewalRequestResponse(updated);
  }

  /**
   * Soumet la demande de renouvellement (DRAFT → PENDING, `submittedAt` posé).
   * La demande attend ensuite la décision d'un administrateur (#271) : aucune
   * licence n'est créée ni prolongée ici, les administrateurs sont prévenus
   * (#269).
   *
   * Exige certificat médical et certificat de licence, et qu'aucune autre
   * demande de l'utilisateur ne soit déjà en attente (409). Les lectures OCR
   * ne bloquent pas l'envoi : ce sont des indices pour l'administrateur.
   * Refusée si la licence actuelle couvre déjà la saison (#250).
   */
  async submitRenewalRequest(userId: string, requestId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { id: requestId, userId },
      select: licenseRenewalSubmitTargetSelect,
    });
    if (!request)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    if (request.status !== LicenseRenewalStatus.DRAFT)
      throw new BadRequestException("La demande a déjà été soumise");

    const hasDocument = (type: LicenseRenewalDocumentType) =>
      request.documents.some((d) => d.type === type);
    if (!hasDocument(LicenseRenewalDocumentType.MEDICAL_CERTIFICATE))
      throw new BadRequestException(
        "Le certificat médical est obligatoire pour soumettre la demande.",
      );
    if (!hasDocument(LicenseRenewalDocumentType.LICENSE_CERTIFICATE))
      throw new BadRequestException(
        "Le certificat de licence est obligatoire pour soumettre la demande.",
      );
    // Submitting hands the certificate to an administrator: same gate as the
    // deposit (#61), for a draft filled before the consent was withdrawn.
    await this.parentalConsent.assertHealthDataAllowed(userId);

    // Renewing is pointless when the current license already runs at least
    // as long as a renewal granted now would (#250): e.g. a license ending
    // this August 31 is renewable from July 1, not in April.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userLicenseValidUntilSelect,
    });
    if (
      user?.license?.validUntil &&
      isLicenseCoveredForRenewal(new Date(user.license.validUntil))
    ) {
      const [year, month, day] = toLicenseQrExpiry(
        new Date(user.license.validUntil),
      ).split("-");
      throw new BadRequestException(
        `Votre licence est déjà valide jusqu'au ${day}/${month}/${year}. Un renouvellement n'est pas nécessaire.`,
      );
    }

    const submitted = await this.markSubmitted(userId, requestId);
    // Fire-and-forget: a notification never fails the submission (#269).
    void this.renewalNotifications.notifyToReview(requestId);
    return toRenewalRequestResponse(submitted);
  }

  /**
   * DRAFT → PENDING under the user lock (#271). Refused (409) while another
   * request of the user awaits a decision: only a draft left over from before
   * #271 can get here. The update is conditional on DRAFT, so of two
   * concurrent submissions of the same request the second one is told the
   * request was already submitted.
   */
  private async markSubmitted(userId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockUserRenewals(tx, userId);
      const otherPending = await tx.licenseRenewalRequest.count({
        where: {
          userId,
          status: LicenseRenewalStatus.PENDING,
          id: { not: requestId },
        },
      });
      if (otherPending > 0) {
        throw new ConflictException(
          "Une demande de renouvellement est déjà en attente de validation.",
        );
      }
      const submittedAt = new Date();
      try {
        return await tx.licenseRenewalRequest.update({
          where: { id: requestId, status: LicenseRenewalStatus.DRAFT },
          data: {
            status: LicenseRenewalStatus.PENDING,
            submittedAt,
            updatedAt: submittedAt,
          },
          select: licenseRenewalRequestResponseSelect,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw new BadRequestException("La demande a déjà été soumise");
        }
        throw error;
      }
    });
  }

  /**
   * Archive le buffer du document dans Azure Blob Storage (conteneur "uploads")
   * et renvoie le nom de blob à persister comme référence. Si le stockage blob
   * n'est pas configuré (tests / dev sans Azure), renvoie le nom de blob sans
   * effectuer d'écriture — le backend reste sans état, aucun accès disque.
   */
  private async persistDocument(
    blobName: string,
    fileBuffer: Buffer,
  ): Promise<string> {
    if (this.blobStorage.isEnabled()) {
      await this.blobStorage.uploadBuffer(
        fileBuffer,
        blobName,
        this.blobStorage.getUploadsContainer(),
      );
    }
    return blobName;
  }
}

/**
 * Serialises the renewal requests of one user (#271) until the caller's
 * transaction ends. A row lock rather than a partial unique index: requests
 * made before #271 may already hold several PENDING per user, and an index
 * that fails to build would fail the migration at container boot (ADR-0017).
 * `FOR NO KEY UPDATE` does not conflict with the `KEY SHARE` locks taken by
 * foreign key checks, so inserting other rows that reference the user is not
 * blocked.
 *
 * Lock-then-read relies on READ COMMITTED (the default): each statement after
 * the lock takes a fresh snapshot and sees what the previous holder committed.
 * Do NOT run it under REPEATABLE READ or SERIALIZABLE: the snapshot is taken
 * at the first statement, so the reads after the lock would miss the request
 * the other transaction just committed.
 *
 * Throws NotFoundException when the user does not exist (deleted account):
 * no row is locked, so nothing would be serialised.
 */
async function lockUserRenewals(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`,
  );
  if (locked.length === 0)
    throw new NotFoundException("Utilisateur non trouvé");
}
