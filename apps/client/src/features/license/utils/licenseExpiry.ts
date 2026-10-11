import { parisDayIndex } from "../../../utils/parisDay";

/**
 * Calcul de l'état d'expiration d'une licence, à partir de la date ISO brute
 * (PAS la chaîne `LicenseUser.validUntil` qui est déjà formatée en fr-FR).
 *
 * Seuils (MVP-5) :
 *   - > 30 jours       → "valid"   (pas de bannière)
 *   - ≤ 30 jours       → "warning" (orange)
 *   - ≤ 7 jours        → "urgent"  (rouge)
 *   - déjà expirée     → "expired" (gris)
 *
 * Même règle que le QR signé et le pass Wallet côté backend
 * (`toLicenseQrExpiry`, #238) : une licence est valide jusqu'à la fin du jour
 * calendaire Europe/Paris de `validUntil`, quelle que soit l'heure stockée
 * (licences bêta à heure quelconque, anciennes dates à minuit) et quel que
 * soit le fuseau du téléphone. Elle est donc expirée dès que le jour de Paris
 * courant est postérieur à celui de `validUntil` (#255), et les jours
 * restants se comptent en jours calendaires de Paris (0 = expire aujourd'hui).
 */
export type LicenseExpiryStatus = "valid" | "warning" | "urgent" | "expired";

export interface LicenseExpiryInfo {
  status: LicenseExpiryStatus;
  /**
   * Jours calendaires (Europe/Paris) restants : `0` = expire aujourd'hui.
   * Si expirée, borné à `≤ -1` (jamais `0` ni `-0`). `null` si date
   * absente/invalide.
   */
  days: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WARNING_THRESHOLD_DAYS = 30;
const URGENT_THRESHOLD_DAYS = 7;

/**
 * Repli si le runtime ne sait pas formater la date à Paris (diff non fini) :
 * ancien calcul à la milliseconde, expirée dès `now > validUntil`.
 */
function msBasedDays(expiry: Date, now: Date): number {
  const diffMs = expiry.getTime() - now.getTime();
  return diffMs < 0
    ? Math.min(-1, Math.floor(diffMs / MS_PER_DAY))
    : Math.ceil(diffMs / MS_PER_DAY);
}

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

  const dayDiff = parisDayIndex(expiry) - parisDayIndex(now);
  const days = Number.isFinite(dayDiff) ? dayDiff : msBasedDays(expiry, now);

  if (days < 0) return { status: "expired", days: Math.min(-1, days) };
  if (days <= URGENT_THRESHOLD_DAYS) return { status: "urgent", days };
  if (days <= WARNING_THRESHOLD_DAYS) return { status: "warning", days };
  return { status: "valid", days };
}

/**
 * Libellé du compte à rebours d'une licence non expirée, partagé par la
 * bannière de l'écran Licence et celle des Réglages (même formulation).
 * @param days Jours restants renvoyés par `computeLicenseExpiry` (≥ 0).
 */
export function formatLicenseExpiryCountdown(days: number): string {
  if (days <= 0) return "Votre licence expire aujourd'hui";
  return `Votre licence expire dans ${days} jour${days > 1 ? "s" : ""}`;
}
