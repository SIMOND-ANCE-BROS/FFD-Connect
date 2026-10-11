import type { RenewalRejectionReason } from "../../../services/api/license-api";

/**
 * Libellés des motifs de refus d'un renouvellement (#268). Mêmes codes que
 * l'API (`RENEWAL_REJECTION_REASONS`) et mêmes libellés que le back-office.
 */
const REJECTION_REASON_LABELS: Record<RenewalRejectionReason, string> = {
  ILLEGIBLE: "Document illisible",
  INCOMPLETE: "Document incomplet",
  CERTIFICATE_TOO_OLD: "Certificat trop ancien",
  NOT_A_MEDICAL_CERTIFICATE: "Ce n'est pas un certificat médical",
  IDENTITY_MISMATCH: "L'identité ne correspond pas",
  LICENSE_MISMATCH: "La licence ne correspond pas",
  MEDICAL_RESTRICTION: "Contre-indication médicale",
  OTHER: "Autre motif",
};

/**
 * Libellé lisible d'un code de motif ; `null` sans motif (demande antérieure
 * à la modération). Un code inconnu (ajouté côté serveur après cette version
 * de l'app) retombe sur « Autre motif » plutôt que d'afficher le code brut.
 */
export function rejectionReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return REJECTION_REASON_LABELS[isKnownReason(reason) ? reason : "OTHER"];
}

const isKnownReason = (reason: string): reason is RenewalRejectionReason =>
  Object.prototype.hasOwnProperty.call(REJECTION_REASON_LABELS, reason);
