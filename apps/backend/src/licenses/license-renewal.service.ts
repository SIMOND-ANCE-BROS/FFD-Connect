import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
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
import { approvePendingRenewal } from "./license-renewal-approval";
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
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private blobStorage: BlobStorageService,
    private renewalDocumentFiles: RenewalDocumentFileCleaner,
  ) {}

  /** Crée ou récupère une demande de renouvellement en brouillon pour l'utilisateur. */
  async startRenewalRequest(userId: string) {
    const existing = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId, status: LicenseRenewalStatus.DRAFT },
      select: licenseRenewalRequestResponseSelect,
    });
    if (existing) return toRenewalRequestResponse(existing);
    const created = await this.prisma.licenseRenewalRequest.create({
      data: { userId, status: LicenseRenewalStatus.DRAFT },
      select: licenseRenewalRequestResponseSelect,
    });
    return toRenewalRequestResponse(created);
  }

  /** Récupère la demande de renouvellement en cours (brouillon ou soumise) pour l'utilisateur. */
  async getMyRenewalRequest(userId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: licenseRenewalRequestResponseSelect,
    });
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
   * Exige certificat médical et certificat de licence.
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
    const hasLicenseNumber =
      Boolean(
        licenseOcr?.licenseNumber && licenseOcr.licenseNumber.length > 0,
      ) || Boolean(user?.license?.number && user.license.number.length > 0);
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

    const submittedAt = new Date();
    await this.prisma.licenseRenewalRequest.update({
      where: { id: requestId },
      data: {
        status: LicenseRenewalStatus.PENDING,
        submittedAt,
        updatedAt: submittedAt,
      },
      select: idOnlySelect,
    });
    return this.autoApprove(requestId);
  }

  /**
   * Auto-approbation à la soumission (en place jusqu'à #271, qui la retirera au
   * profit de la seule modération humaine). Même cœur que la décision admin
   * (`approvePendingRenewal`) : passage conditionnel PENDING → APPROVED puis
   * upsert de la licence, dans UNE transaction (#261).
   */
  private async autoApprove(requestId: string) {
    await this.prisma.$transaction((tx) =>
      approvePendingRenewal(tx, requestId, {
        reviewerId: null,
        now: new Date(),
      }),
    );
    const approved = await this.prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: licenseRenewalRequestResponseSelect,
    });
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
