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
 * Cohérent avec le backend (#238, `toLicenseQrExpiry`) : `validUntil` est le
 * dernier instant d'un jour calendaire Europe/Paris. La licence est donc
 * expirée dès que `now > validUntil` (#255), et les jours restants se
 * comptent en jours calendaires de Paris, quel que soit le fuseau du
 * téléphone (0 = expire aujourd'hui).
 */
export type LicenseExpiryStatus = "valid" | "warning" | "urgent" | "expired";

export interface LicenseExpiryInfo {
  status: LicenseExpiryStatus;
  /**
   * Jours calendaires (Europe/Paris) restants : `0` = expire aujourd'hui,
   * strictement négatif (≤ -1, jamais `-0`) si expirée, `null` si date
   * absente/invalide.
   */
  days: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WARNING_THRESHOLD_DAYS = 30;
const URGENT_THRESHOLD_DAYS = 7;

/** Fuseau du jour de validité FFD (backend #238). */
const FFD_TIME_ZONE = "Europe/Paris";

const PARIS_DAY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: FFD_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** Index du jour calendaire de `instant` à Paris (jours depuis l'epoch). */
function parisDayIndex(instant: Date): number {
  const parts = PARIS_DAY_PARTS.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
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

  // Expirée dès l'instant qui suit `validUntil`, même le jour même (#255).
  if (now.getTime() > expiry.getTime()) {
    return { status: "expired", days: Math.min(-1, dayDiff) };
  }

  const days = Math.max(0, dayDiff);
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
