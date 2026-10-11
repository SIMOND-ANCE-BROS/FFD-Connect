import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { CodedBadRequestException } from "../common/errors/coded-bad-request.exception";
import { OcrService } from "../utils/ocr.service";
import {
  idOnlySelect,
  licenseRenewalRequestResponseSelect,
  licenseRenewalSubmitTargetSelect,
  licenseRenewalUploadTargetSelect,
} from "../utils/prisma-selects";
import {
  MEDICAL_CERTIFICATE_VALIDITY_MONTHS,
  medicalCertificatePurgeDueAt,
} from "./medical-certificate-retention.util";
import { isLicenseCoveredForRenewal } from "./license-season";
import { normalizeLicenseNumber } from "./license-number.util";
import {
  approvePendingRenewal,
  LicenseNumberTakenException,
  LicenseNumberUnknownException,
} from "./license-renewal-approval";
import { LicenseRenewalNotificationService } from "./license-renewal-notification.service";
import { toLicenseQrExpiry } from "./qr/license-qr";
import {
  pickRenewalOcrData,
  RenewalOcrData,
  toRenewalRequestResponse,
} from "./renewal-ocr-data.util";

/**
 * Âge maximum du certificat médical en mois (règle fédération : certificat
 * récent). Importé plutôt que redéclaré : refuser un certificat parce qu'il est
 * trop vieux et calculer la date de sa purge (#62) reposent sur la MÊME notion
 * de validité, et deux constantes finiraient par diverger.
 */
const MEDICAL_CERTIFICATE_MAX_AGE_MONTHS = MEDICAL_CERTIFICATE_VALIDITY_MONTHS;

/**
 * Stable codes of the refusals whose message is health data (#225). The user
 * still reads the French message; the logs only ever see the code.
 */
export const RenewalErrorCode = {
  /** The certificate states a contraindication. */
  MEDICAL_UNFIT: "MEDICAL_UNFIT",
  /** Fitness could not be read on the certificate. */
  MEDICAL_FITNESS_UNCONFIRMED: "MEDICAL_FITNESS_UNCONFIRMED",
  /** The certificate is older than the federation allows (message has its date). */
  MEDICAL_CERTIFICATE_TOO_OLD: "MEDICAL_CERTIFICATE_TOO_OLD",
} as const;

/**
 * The only code the logs see for any of the refusals above: the fine codes
 * go to the client, but logged next to a request they would still reveal the
 * user's fitness.
 */
export const RENEWAL_DOCUMENT_REJECTED = "RENEWAL_DOCUMENT_REJECTED";

@Injectable()
export class LicenseRenewalService {
  private readonly logger = new Logger(LicenseRenewalService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private blobStorage: BlobStorageService,
    private renewalDocumentFiles: RenewalDocumentFileCleaner,
    private renewalNotifications: LicenseRenewalNotificationService,
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

    // Only the whitelisted fields are kept (#224): the OCR must not be able to
    // persist raw certificate text, whatever it returns.
    let ocrData: RenewalOcrData | null = null;
    if (type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      const medical =
        pickRenewalOcrData(
          type,
          await this.ocrService.extractMedicalCertificateInfo(fileBuffer),
        ) ?? {};
      ocrData = medical;
      if (medical.isApte === false) {
        throw new CodedBadRequestException(
          RenewalErrorCode.MEDICAL_UNFIT,
          "Le certificat médical indique que vous n'êtes pas apte à la pratique. Le document ne peut pas être accepté.",
          RENEWAL_DOCUMENT_REJECTED,
        );
      }
      if (medical.isApte !== true) {
        throw new CodedBadRequestException(
          RenewalErrorCode.MEDICAL_FITNESS_UNCONFIRMED,
          "Impossible de confirmer l'aptitude sur le certificat médical. Assurez-vous que le document mentionne clairement « apte à la pratique » ou « ne présente pas de contre-indication » et que l'image est lisible.",
          RENEWAL_DOCUMENT_REJECTED,
        );
      }
      this.assertMedicalCertificateDateValid(medical);
    }
    if (type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE) {
      ocrData = pickRenewalOcrData(
        type,
        await this.ocrService.extractLicenseInfo(fileBuffer),
      );
    }

    // L'OCR (et ses validations) ayant réussi, on archive le document dans Blob.
    // Si le stockage blob n'est pas configuré (tests, dev local), on conserve
    // simplement le nom de blob comme référence — aucune écriture disque.
    const storedReference = await this.persistDocument(blobName, fileBuffer);

    // Fichiers du document remplacé (même type) : lus avant le remplacement,
    // supprimés une fois la nouvelle ligne enregistrée — sinon le certificat
    // médical précédent (RGPD art. 9) resterait orphelin dans Blob.
    const replacedReferences = request.documents
      .filter((d) => d.type === type && d.filePath !== storedReference)
      .map((d) => d.filePath);

    try {
      // Remplacement atomique : si la création échoue, l'ancien document reste
      // en base (et son fichier est conservé).
      await this.prisma.$transaction([
        this.prisma.licenseRenewalDocument.deleteMany({
          where: { requestId, type },
        }),
        this.prisma.licenseRenewalDocument.create({
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
        }),
      ]);
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
   * Soumet la demande de renouvellement (DRAFT → PENDING, `submittedAt` posé,
   * puis APPROVED).
   * Exige certificat médical et certificat de licence, et qu'aucune autre
   * demande de l'utilisateur ne soit déjà en attente (409, #271).
   * Si les deux validations OCR passent, la demande est auto-approuvée et la licence est renouvelée.
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

    const medicalDoc = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    const licenseDoc = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
    );

    if (!medicalDoc)
      throw new BadRequestException(
        "Le certificat médical est obligatoire pour soumettre la demande.",
      );
    if (!licenseDoc)
      throw new BadRequestException(
        "Le certificat de licence est obligatoire pour soumettre la demande.",
      );

    const medicalOcr = pickRenewalOcrData(medicalDoc.type, medicalDoc.ocrData);
    if (medicalOcr?.isApte !== true) {
      throw new CodedBadRequestException(
        RenewalErrorCode.MEDICAL_FITNESS_UNCONFIRMED,
        "Le certificat médical n'a pas été reconnu comme attestant votre aptitude. Veuillez déposer un document où « apte à la pratique » est clairement lisible.",
        RENEWAL_DOCUMENT_REJECTED,
      );
    }
    this.assertMedicalCertificateDateValid(medicalOcr);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { license: { select: { number: true, validUntil: true } } },
    });
    const licenseOcr = pickRenewalOcrData(licenseDoc.type, licenseDoc.ocrData);
    // Same reading as the approval core (trimmed, shaped like a licence
    // number): a blank or garbled OCR number must not pass submission and
    // then fail the approval.
    const hasLicenseNumber =
      normalizeLicenseNumber(licenseOcr?.licenseNumber) !== null ||
      (user?.license?.number.trim() ?? "") !== "";
    if (!hasLicenseNumber) {
      throw new BadRequestException(
        "Le certificat de licence n'a pas permis d'identifier un numéro de licence. Assurez-vous que le document est lisible et mentionne le numéro de licence.",
      );
    }

    // Renewing is pointless when the current license already runs at least
    // as long as a renewal granted now would (#250): e.g. a license ending
    // this August 31 is renewable from July 1, not in April.
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

    await this.markSubmitted(userId, requestId);
    return this.autoApprove(requestId);
  }

  /**
   * DRAFT → PENDING under the user lock (#271). Refused (409) while another
   * request of the user awaits a decision: only a draft left over from before
   * #271 can get here. The update is conditional on DRAFT, so of two
   * concurrent submissions of the same request the second one is told the
   * request was already submitted.
   */
  private async markSubmitted(userId: string, requestId: string) {
    await this.prisma.$transaction(async (tx) => {
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
        await tx.licenseRenewalRequest.update({
          where: { id: requestId, status: LicenseRenewalStatus.DRAFT },
          data: {
            status: LicenseRenewalStatus.PENDING,
            submittedAt,
            updatedAt: submittedAt,
          },
          select: idOnlySelect,
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
   * Auto-approbation à la soumission (en place jusqu'à #271, qui la retirera au
   * profit de la seule modération humaine). Même cœur que la décision admin
   * (`approvePendingRenewal`) : passage conditionnel PENDING → APPROVED puis
   * upsert de la licence, dans UNE transaction (#261).
   */
  private async autoApprove(requestId: string) {
    try {
      await this.prisma.$transaction((tx) =>
        approvePendingRenewal(tx, requestId, {
          reviewerId: null,
          now: new Date(),
        }),
      );
    } catch (error) {
      // Licence number unknown, or already another account's: not the
      // licensee's to fix, and the 409 wording would reveal that a number is
      // registered. The transaction rolled back: the request stays PENDING
      // for the administrator, and the licensee sees it as submitted.
      if (
        !(error instanceof LicenseNumberUnknownException) &&
        !(error instanceof LicenseNumberTakenException)
      ) {
        // Any other failure rolled the approval back as well: the request is
        // still PENDING and awaits a human (#269) — unless a concurrent
        // decision already settled it (409).
        if (!(error instanceof ConflictException)) {
          void this.renewalNotifications.notifyToReview(requestId);
        }
        throw error;
      }
      this.logger.warn(
        `Licence renewal ${requestId} left PENDING for human review (${error.constructor.name})`,
      );
    }
    const approved = await this.prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: licenseRenewalRequestResponseSelect,
    });
    // Left PENDING: a human must review it, the administrators are told
    // (#269), fire-and-forget so a notification never fails the submission.
    // An automatic approval notifies no one: the licensee reads the outcome
    // in this very response, and there is nothing left to review.
    if (approved.status === LicenseRenewalStatus.PENDING) {
      void this.renewalNotifications.notifyToReview(requestId);
    }
    return toRenewalRequestResponse(approved);
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

  private assertMedicalCertificateDateValid(ocrData: RenewalOcrData): void {
    const dateStr = ocrData.date;
    if (!dateStr) return;
    const certDate = new Date(dateStr);
    if (Number.isNaN(certDate.getTime())) return;
    const limit = new Date();
    limit.setMonth(limit.getMonth() - MEDICAL_CERTIFICATE_MAX_AGE_MONTHS);
    if (certDate < limit) {
      throw new CodedBadRequestException(
        RenewalErrorCode.MEDICAL_CERTIFICATE_TOO_OLD,
        `Le certificat médical doit dater de moins de ${MEDICAL_CERTIFICATE_MAX_AGE_MONTHS} mois. La date détectée (${dateStr}) est trop ancienne.`,
        RENEWAL_DOCUMENT_REJECTED,
      );
    }
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
