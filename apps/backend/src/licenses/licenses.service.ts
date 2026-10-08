import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OcrService } from "../utils/ocr.service";
import { licenseBaseSelect } from "../utils/prisma-selects";
import { LicenseQrService } from "./qr/license-qr.service";

@Injectable()
export class LicensesService {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private licenseQrService: LicenseQrService,
  ) {}

  /**
   * Récupère la licence d'un utilisateur, avec le contenu de son QR signé
   * (`qrCode`, null si la signature est désactivée — #168).
   */
  async getLicense(userId: string) {
    const license = await this.prisma.license.findUnique({
      where: { userId },
      select: licenseBaseSelect,
    });
    if (!license) throw new NotFoundException("License non trouvée");
    return { ...license, qrCode: this.licenseQrService.buildQrCode(license) };
  }

  /**
   * Renouvelle la licence d'un utilisateur à partir d'un certificat (OCR direct).
   * Le certificat est fourni sous forme de buffer (upload mémoire) : il sert
   * uniquement à l'OCR et n'est jamais persisté.
   */
  async renewLicense(userId: string, certificate: Buffer) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        category: true,
        clubName: true,
        license: {
          select: {
            id: true,
            number: true,
            validUntil: true,
            category: true,
            clubName: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException("Utilisateur non trouvé");

    const ocrData = await this.ocrService.extractLicenseInfo(certificate);

    if (!ocrData.licenseNumber && !user.license) {
      throw new BadRequestException(
        "Impossible de valider le certificat : numéro de licence non détecté",
      );
    }

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    nextYear.setMonth(7);
    nextYear.setDate(31);

    const licenseNumber =
      ocrData.licenseNumber ??
      user.license?.number ??
      `FFD-${Math.floor(Math.random() * 1000000)}`;

    if (!user.clubName) {
      throw new BadRequestException(
        "Impossible de créer la licence : le club de l'utilisateur n'est pas renseigné",
      );
    }

    return this.prisma.license.upsert({
      where: { userId },
      update: {
        validUntil: nextYear,
        updatedAt: new Date(),
      },
      create: {
        userId,
        number: licenseNumber,
        validUntil: nextYear,
        category: user.category ?? "Standard",
        clubName: user.clubName,
      },
    });
  }

  /**
   * Valide une licence de staff (WDSF / Legacy).
   * Vérifie dans la base locale qu'une licence active existe pour ce numéro.
   */
  async validateStaffLicense(licenseNumber: string) {
    const license = await this.prisma.license.findFirst({
      where: {
        number: licenseNumber,
        validUntil: { gte: new Date() },
      },
      select: {
        number: true,
        category: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    if (!license) {
      return { isValid: false, licenseNumber, holder: null, role: null };
    }

    return {
      isValid: true,
      licenseNumber: license.number,
      holder: license.user
        ? `${license.user.firstName} ${license.user.lastName}`
        : null,
      role: license.category,
    };
  }
}
