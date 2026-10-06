/**
 * Règle de rétention des certificats médicaux (RGPD art. 5.1.e, issue #62).
 *
 * La politique de confidentialité PUBLIÉE engage l'éditeur :
 *
 *   « Données de santé (certificat médical) : conservées le temps nécessaire à
 *     la vérification de l'aptitude, puis supprimées au plus tard 12 mois après
 *     la fin de validité du certificat. »
 *
 * Ce module traduit cette phrase en une date, et rien d'autre. Il est pur et
 * testé exhaustivement : une erreur ici, c'est soit un engagement public non
 * tenu, soit la destruction d'une pièce encore utile.
 */

/**
 * Durée de validité d'un certificat médical, en mois.
 *
 * Même valeur que l'âge maximal accepté à l'upload : le code refuse un
 * certificat plus vieux que ça, ce qui revient à dire qu'il n'est plus valide.
 * Exporté ici pour qu'il n'existe qu'UNE définition de « validité » dans le
 * dépôt — `LicenseRenewalService` l'importe plutôt que de la redéclarer.
 */
export const MEDICAL_CERTIFICATE_VALIDITY_MONTHS = 12;

/** Délai de conservation après la fin de validité, tel qu'annoncé au public. */
export const HEALTH_DATA_RETENTION_MONTHS = 12;

/** Le minimum nécessaire pour dater un document ; `ocrData` est un `Json?`. */
export interface RetainableMedicalDocument {
  readonly createdAt: Date;
  readonly ocrData: unknown;
}

/**
 * Ajoute des mois en bornant le jour au dernier jour du mois d'arrivée.
 *
 * `setMonth` déborde tout seul : 31 janvier + 1 mois donnerait le 3 mars. Pour
 * une échéance de suppression, déborder signifierait conserver deux jours de
 * trop — faible, mais c'est un engagement public, et la version bornée est
 * aussi simple à lire.
 */
function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  // Tout en UTC : avec les accesseurs locaux, l'échéance d'un document
  // dépendrait du fuseau de la machine qui l'évalue — un conteneur en UTC et un
  // poste à Paris ne tomberaient pas d'accord sur le jour de la suppression.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

/** Date d'émission lue dans l'OCR, ou `null` si absente ou illisible. */
function issuedAtOf(ocrData: unknown): Date | null {
  if (typeof ocrData !== "object" || ocrData === null) return null;
  const raw = (ocrData as { date?: unknown }).date;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Date à partir de laquelle le document DOIT avoir disparu.
 *
 * Deux cas, et leur asymétrie est voulue :
 *
 * - **Date d'émission connue** → `émission + validité + rétention`. On tient le
 *   document exactement aussi longtemps que l'engagement l'autorise.
 *
 * - **Date absente ou illisible** (l'OCR échoue, et le code d'upload accepte ce
 *   cas) → `dépôt + rétention`, sans compter la validité. Un certificat est
 *   accepté jusqu'à {@link MEDICAL_CERTIFICATE_VALIDITY_MONTHS} mois après son
 *   émission, donc l'émission se situe quelque part entre `dépôt - validité` et
 *   `dépôt` : l'échéance réelle est donc au plus tôt `dépôt + rétention`.
 *   **On retient cette borne basse**, ce qui peut supprimer jusqu'à un an trop
 *   tôt mais ne peut JAMAIS supprimer trop tard. Entre conserver une donnée de
 *   santé au-delà de la parole donnée et l'effacer en avance, le RGPD tranche
 *   dans le sens de l'effacement.
 */
export function medicalCertificatePurgeDueAt(
  document: RetainableMedicalDocument,
): Date {
  const issuedAt = issuedAtOf(document.ocrData);
  if (issuedAt === null) {
    return addMonths(document.createdAt, HEALTH_DATA_RETENTION_MONTHS);
  }
  return addMonths(
    issuedAt,
    MEDICAL_CERTIFICATE_VALIDITY_MONTHS + HEALTH_DATA_RETENTION_MONTHS,
  );
}

/** `true` si le document a dépassé son échéance à l'instant `now`. */
export function isMedicalCertificateDue(
  document: RetainableMedicalDocument,
  now: Date,
): boolean {
  return medicalCertificatePurgeDueAt(document).getTime() <= now.getTime();
}

/**
 * Âge minimal, en mois, qu'un document doit avoir pour être ne serait-ce que
 * CANDIDAT à la purge — sert à borner la requête SQL.
 *
 * C'est la plus petite échéance possible, celle du cas « date illisible ».
 * Filtrer sur `createdAt` plus récent que ça serait charger des lignes qui ne
 * peuvent pas être dues ; filtrer plus large ne raterait rien de plus.
 */
export const MIN_AGE_BEFORE_PURGE_MONTHS = HEALTH_DATA_RETENTION_MONTHS;

/** Borne `createdAt` au-delà de laquelle un document ne peut pas être dû. */
export function purgeCandidateCutoff(now: Date): Date {
  return addMonths(now, -MIN_AGE_BEFORE_PURGE_MONTHS);
}
