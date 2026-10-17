import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { practisedDiscipline } from "../common/competition-level/competition-level.util";
import { licenseWithHolderDisciplineSelect } from "../utils/prisma-selects";
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
   *
   * `supportAccess` (session « se connecter en tant que », #759) : ni QR
   * statique (valable jusqu'à la fin de la licence, il ferait entrer
   * l'intervenant à la place du titulaire) ni pass Wallet, qui le porte.
   */
  async getLicense(userId: string, { supportAccess = false } = {}) {
    const found = await this.prisma.license.findUnique({
      where: { userId },
      select: licenseWithHolderDisciplineSelect,
    });
    if (!found) throw new NotFoundException("License non trouvée");
    // The holder's profile only feeds `discipline`: not echoed in the payload.
    const { user, ...license } = found;
    return {
      ...license,
      // Discipline(s) actually practised (#552) — same value as the Wallet pass.
      discipline: practisedDiscipline(user, license.category),
      qrCode: supportAccess ? null : this.licenseQrService.buildQrCode(license),
      appleWalletAvailable:
        !supportAccess && this.appleWalletPassGenerator.isAvailable(),
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
