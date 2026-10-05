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
import { OcrService } from "../utils/ocr.service";

/** Âge maximum du certificat médical en mois (règle fédération : certificat récent). */
const MEDICAL_CERTIFICATE_MAX_AGE_MONTHS = 12;

@Injectable()
export class LicenseRenewalService {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private blobStorage: BlobStorageService,
  ) {}

  /** Crée ou récupère une demande de renouvellement en brouillon pour l'utilisateur. */
  async startRenewalRequest(userId: string) {
    const existing = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId, status: LicenseRenewalStatus.DRAFT },
      include: { documents: true },
    });
    if (existing) return existing;
    return this.prisma.licenseRenewalRequest.create({
      data: { userId, status: LicenseRenewalStatus.DRAFT },
      include: { documents: true },
    });
  }

  /** Récupère la demande de renouvellement en cours (brouillon ou soumise) pour l'utilisateur. */
  async getMyRenewalRequest(userId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        documents: true,
      },
    });
    return request ?? null;
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
      include: { documents: true },
    });
    if (!request)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    if (request.status !== LicenseRenewalStatus.DRAFT)
      throw new BadRequestException(
        "Seules les demandes en brouillon peuvent recevoir des documents",
      );

    let ocrData: Record<string, unknown> | null = null;
    if (type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      const medical =
        await this.ocrService.extractMedicalCertificateInfo(fileBuffer);
      ocrData = medical;
      if (ocrData.isApte === false) {
        throw new BadRequestException(
          "Le certificat médical indique que vous n'êtes pas apte à la pratique. Le document ne peut pas être accepté.",
        );
      }
      if (ocrData.isApte !== true) {
        throw new BadRequestException(
          "Impossible de confirmer l'aptitude sur le certificat médical. Assurez-vous que le document mentionne clairement « apte à la pratique » ou « ne présente pas de contre-indication » et que l'image est lisible.",
        );
      }
      this.assertMedicalCertificateDateValid(ocrData, "upload");
    }
    if (type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE) {
      const licenseInfo = await this.ocrService.extractLicenseInfo(fileBuffer);
      ocrData = licenseInfo;
    }

    // L'OCR (et ses validations) ayant réussi, on archive le document dans Blob.
    // Si le stockage blob n'est pas configuré (tests, dev local), on conserve
    // simplement le nom de blob comme référence — aucune écriture disque.
    const storedReference = await this.persistDocument(blobName, fileBuffer);

    await this.prisma.licenseRenewalDocument.deleteMany({
      where: { requestId, type },
    });

    await this.prisma.licenseRenewalDocument.create({
      data: {
        requestId,
        type,
        filePath: storedReference,
        ocrData: (ocrData as unknown) ?? undefined,
      },
    });

    return this.prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { documents: true },
    });
  }

  /**
   * Soumet la demande de renouvellement (DRAFT → PENDING ou APPROVED).
   * Exige certificat médical et certificat de licence.
   * Si les deux validations OCR passent, la demande est auto-approuvée et la licence est renouvelée.
   */
  async submitRenewalRequest(userId: string, requestId: string) {
    const request = await this.prisma.licenseRenewalRequest.findFirst({
      where: { id: requestId, userId },
      include: { documents: true },
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

    const medicalOcr = medicalDoc.ocrData as {
      isApte?: boolean;
      date?: string;
    } | null;
    if (medicalOcr?.isApte !== true) {
      throw new BadRequestException(
        "Le certificat médical n'a pas été reconnu comme attestant votre aptitude. Veuillez déposer un document où « apte à la pratique » est clairement lisible.",
      );
    }
    this.assertMedicalCertificateDateValid(medicalOcr, "submit");

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { license: { select: { number: true, validUntil: true } } },
    });
    const licenseOcr = licenseDoc.ocrData as { licenseNumber?: string } | null;
    const hasLicenseNumber =
      Boolean(
        licenseOcr?.licenseNumber && licenseOcr.licenseNumber.length > 0,
      ) || Boolean(user?.license?.number && user.license.number.length > 0);
    if (!hasLicenseNumber) {
      throw new BadRequestException(
        "Le certificat de licence n'a pas permis d'identifier un numéro de licence. Assurez-vous que le document est lisible et mentionne le numéro de licence.",
      );
    }

    const nextSeasonEnd = this.getNextSeasonEndDate();
    if (
      user?.license?.validUntil &&
      new Date(user.license.validUntil) >= nextSeasonEnd
    ) {
      throw new BadRequestException(
        "Votre licence est déjà valide pour la prochaine saison. Un renouvellement n'est pas nécessaire.",
      );
    }

    await this.prisma.licenseRenewalRequest.update({
      where: { id: requestId },
      data: { status: LicenseRenewalStatus.PENDING, updatedAt: new Date() },
    });
    return this.approveRenewalRequest(requestId);
  }

  /**
   * Approuve une demande de renouvellement (admin ou processus auto) et renouvelle la licence.
   */
  async approveRenewalRequest(requestId: string) {
    const request = await this.prisma.licenseRenewalRequest.findUnique({
      where: { id: requestId },
      include: {
        documents: true,
        user: { include: { license: true } },
      },
    });
    if (!request)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    if (request.status !== LicenseRenewalStatus.PENDING)
      throw new BadRequestException(
        "Seules les demandes en attente peuvent être approuvées",
      );

    const licenseCert = request.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
    );
    const ocrLicenseNumber =
      licenseCert?.ocrData &&
      typeof licenseCert.ocrData === "object" &&
      "licenseNumber" in licenseCert.ocrData
        ? String(
            (licenseCert.ocrData as { licenseNumber?: string }).licenseNumber,
          )
        : null;

    const nextYear = this.getNextSeasonEndDate();

    const licenseNumber =
      ocrLicenseNumber ??
      request.user.license?.number ??
      `FFD-${Math.floor(Math.random() * 1000000)}`;

    await this.prisma.license.upsert({
      where: { userId: request.userId },
      update: { validUntil: nextYear, updatedAt: new Date() },
      create: {
        userId: request.userId,
        number: licenseNumber,
        validUntil: nextYear,
        category: request.user.category ?? "Standard",
        clubName: request.user.clubName ?? "Club",
      },
    });

    return this.prisma.licenseRenewalRequest.update({
      where: { id: requestId },
      data: { status: LicenseRenewalStatus.APPROVED, updatedAt: new Date() },
      include: { documents: true },
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

  private assertMedicalCertificateDateValid(
    ocrData: { date?: string },
    context: "upload" | "submit",
  ): void {
    void context;
    const dateStr = ocrData.date;
    if (!dateStr) return;
    const certDate = new Date(dateStr);
    if (Number.isNaN(certDate.getTime())) return;
    const limit = new Date();
    limit.setMonth(limit.getMonth() - MEDICAL_CERTIFICATE_MAX_AGE_MONTHS);
    if (certDate < limit) {
      throw new BadRequestException(
        `Le certificat médical doit dater de moins de ${MEDICAL_CERTIFICATE_MAX_AGE_MONTHS} mois. La date détectée (${dateStr}) est trop ancienne.`,
      );
    }
  }

  private getNextSeasonEndDate(): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    d.setMonth(7);
    d.setDate(31);
    return d;
  }
}
