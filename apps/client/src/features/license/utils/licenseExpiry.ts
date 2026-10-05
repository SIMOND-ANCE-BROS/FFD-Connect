/**
 * Calcul de l'état d'expiration d'une licence, à partir de la date ISO brute
 * (PAS la chaîne `LicenseUser.validUntil` qui est déjà formatée en fr-FR).
 *
 * Seuils (MVP-5) :
 *   - > 30 jours       → "valid"   (pas de bannière)
 *   - ≤ 30 jours       → "warning" (orange)
 *   - ≤ 7 jours        → "urgent"  (rouge)
 *   - déjà expirée     → "expired" (gris)
 */
export type LicenseExpiryStatus = "valid" | "warning" | "urgent" | "expired";

export interface LicenseExpiryInfo {
  status: LicenseExpiryStatus;
  /** Jours restants (négatif si expirée), `null` si date absente/invalide. */
  days: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WARNING_THRESHOLD_DAYS = 30;
const URGENT_THRESHOLD_DAYS = 7;

/**
 * @param validUntil Date d'expiration (ISO string ou Date). `null`/invalide → "valid".
 * @param now Date de référence (injectable pour les tests). Défaut : maintenant.
 */
export function computeLicenseExpiry(
  validUntil: string | Date | null | undefined,
  now: Date = new Date(),
): LicenseExpiryInfo {
  if (validUntil == null || validUntil === "") {
    return { status: "valid", days: null };
  }

  const expiry = validUntil instanceof Date ? validUntil : new Date(validUntil);
  if (Number.isNaN(expiry.getTime())) {
    return { status: "valid", days: null };
  }

  const days = Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY);

  if (days < 0) return { status: "expired", days };
  if (days <= URGENT_THRESHOLD_DAYS) return { status: "urgent", days };
  if (days <= WARNING_THRESHOLD_DAYS) return { status: "warning", days };
  return { status: "valid", days };
}
