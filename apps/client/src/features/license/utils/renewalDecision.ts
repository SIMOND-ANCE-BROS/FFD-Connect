import type { RenewalRejectionReason } from "../../../services/api/license-api";

/**
 * Labels of a renewal refusal reason (#268): same codes as the API
 * (`RENEWAL_REJECTION_REASONS`), same wording as the back-office.
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
 * Readable label of a reason code; `null` without a reason (request older
 * than the moderation). An unknown code (added server-side after this app
 * version) falls back to « Autre motif » rather than showing the raw code.
 */
export function rejectionReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return REJECTION_REASON_LABELS[isKnownReason(reason) ? reason : "OTHER"];
}

const isKnownReason = (reason: string): reason is RenewalRejectionReason =>
  Object.prototype.hasOwnProperty.call(REJECTION_REASON_LABELS, reason);
