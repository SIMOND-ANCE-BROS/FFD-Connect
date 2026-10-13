import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { licenseBaseSelect } from "../utils/prisma-selects";
import { licenseValidityFloor } from "./license-expiry";
import { LicenseQrService } from "./qr/license-qr.service";
import { AppleWalletPassGenerator } from "./wallet/apple-wallet-pass.generator";

@Injectable()
export class LicensesService {
  constructor(
    private prisma: PrismaService,
    private licenseQrService: LicenseQrService,
    private appleWalletPassGenerator: AppleWalletPassGenerator,
  ) {}

  /**
   * Récupère la licence d'un utilisateur, avec le contenu de son QR signé
   * (`qrCode`, null si la signature est désactivée — #168) et la
   * disponibilité du pass Apple Wallet (`appleWalletAvailable` — #162).
   */
  async getLicense(userId: string) {
    const license = await this.prisma.license.findUnique({
      where: { userId },
      select: licenseBaseSelect,
    });
    if (!license) throw new NotFoundException("License non trouvée");
    return {
      ...license,
      qrCode: this.licenseQrService.buildQrCode(license),
      appleWalletAvailable: this.appleWalletPassGenerator.isAvailable(),
    };
  }

  /**
   * Valide une licence de staff (WDSF / Legacy).
   * Vérifie dans la base locale qu'une licence active existe pour ce numéro.
   */
  async validateStaffLicense(licenseNumber: string) {
    const license = await this.prisma.license.findFirst({
      where: {
        number: licenseNumber,
        // Valid through the whole Paris day of validUntil (#384).
        validUntil: { gte: licenseValidityFloor() },
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
