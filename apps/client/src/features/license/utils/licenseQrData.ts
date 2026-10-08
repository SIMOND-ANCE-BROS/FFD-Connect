import type { LicenseUser } from "../components/license-card/license-card.types";

/**
 * Contenu du QR d'une licence (#168).
 *
 * Le serveur fournit un QR signé (`user.qrCode`) : on l'affiche TEL QUEL, sans
 * le reconstruire, car le check-in vérifie sa signature. À défaut (backend
 * ancien, signature désactivée, snapshot antérieur), repli sur l'ancien
 * contenu non signé, accepté tant que le mode n'est pas « enforce ».
 */
export function buildLicenseQrData(user: LicenseUser, type: string): string {
  if (user.qrCode) return user.qrCode;
  return JSON.stringify({
    id: user.licenseNumber,
    name: `${user.lastName} ${user.firstName}`,
    valid: true,
    type,
  });
}
