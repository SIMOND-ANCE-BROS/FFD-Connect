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

/**
 * Date d'émission lue dans l'OCR, ou `null` si absente ou illisible.
 *
 * **PLAFONNÉE À LA DATE DE DÉPÔT, ET C'EST ESSENTIEL.** Cette valeur vient de
 * l'OCR d'un document fourni par l'utilisateur : il en contrôle donc le contenu.
 * Sans plafond, un certificat portant une date future — falsifiée, ou simplement
 * mal lue (« 01/01/2099 ») — repousserait l'échéance d'autant, et la donnée de
 * santé ne serait JAMAIS purgée. Soit exactement l'inverse de l'engagement
 * publié, déclenché par la seule partie qui a intérêt à le contourner.
 *
 * Un certificat ne peut pas avoir été émis après avoir été déposé. Une date
 * postérieure est donc du bruit, et on retient le dépôt.
 */
function issuedAtOf(ocrData: unknown, uploadedAt: Date): Date | null {
  if (typeof ocrData !== "object" || ocrData === null) return null;
  const raw = (ocrData as { date?: unknown }).date;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime() > uploadedAt.getTime() ? uploadedAt : parsed;
}

/**
 * Date à partir de laquelle le document DOIT avoir disparu.
 *
 * Deux cas, et leur asymétrie est voulue :
 *
 * - **Date d'émission connue** → `émission + validité + rétention`. On tient le
 *   document exactement aussi longtemps que l'engagement l'autorise.
 *
 * - **Date postérieure au dépôt** (impossible, donc falsifiée ou mal lue) → elle
 *   est ramenée au dépôt, ce qui plafonne l'échéance à `dépôt + validité +
 *   rétention`. Voir {@link issuedAtOf} : sans ce plafond, la purge serait
 *   contournable par celui-là même qu'elle protège.
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
  const issuedAt = issuedAtOf(document.ocrData, document.createdAt);
  if (issuedAt === null) {
    return addMonths(document.createdAt, HEALTH_DATA_RETENTION_MONTHS);
  }
  return addMonths(
    issuedAt,
    MEDICAL_CERTIFICATE_VALIDITY_MONTHS + HEALTH_DATA_RETENTION_MONTHS,
  );
}
