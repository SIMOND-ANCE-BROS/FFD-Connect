import type {
  LicenseRenewalDocument,
  LicenseRenewalRejectionReason,
  LicenseRenewalRequest,
} from "../../../services/api/license-api";

/**
 * Readable label of each rejection reason code an administrator can pick
 * (#266/#268). Shown to the licensee on their refused request.
 */
export const RENEWAL_REJECTION_LABELS: Record<
  LicenseRenewalRejectionReason,
  string
> = {
  ILLEGIBLE: "Document illisible",
  INCOMPLETE: "Dossier incomplet",
  CERTIFICATE_TOO_OLD: "Certificat médical trop ancien",
  NOT_A_MEDICAL_CERTIFICATE:
    "Le document déposé n’est pas un certificat médical",
  IDENTITY_MISMATCH:
    "L’identité indiquée sur le document ne correspond pas à votre compte",
  LICENSE_MISMATCH: "Le numéro de licence ne correspond pas",
  MEDICAL_RESTRICTION:
    "Le certificat médical mentionne une restriction à la pratique",
  OTHER: "Autre motif",
};

/** Fallback for a code added on the server after this app version. */
const UNKNOWN_REASON_LABEL = RENEWAL_REJECTION_LABELS.OTHER;

/**
 * Label of a rejection reason, `null` when the request carries none (not
 * refused, or refused before reasons existed).
 */
export function rejectionReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return (
    (RENEWAL_REJECTION_LABELS as Record<string, string | undefined>)[reason] ??
    UNKNOWN_REASON_LABEL
  );
}

/** A submitted request waiting for the administrator's decision. */
export function isRenewalUnderReview(
  request: Pick<LicenseRenewalRequest, "status"> | null | undefined,
): boolean {
  return request?.status === "PENDING";
}

/**
 * Same validity as the server's medical certificate rule (12 months). Only
 * used to warn: the decision is the administrator's (ADR-0021).
 */
const MEDICAL_CERTIFICATE_MAX_AGE_MONTHS = 12;

/**
 * Hints of the automatic reading of a document, shown at upload. They are
 * informative only and never block the submission (#268): since ADR-0021 the
 * OCR is an aid, an administrator checks every document.
 */
export function getRenewalOcrWarnings(
  doc: Pick<LicenseRenewalDocument, "type" | "ocrData">,
  now: Date = new Date(),
): string[] {
  const ocr = doc.ocrData;
  if (!ocr) return ["Le document n’a pas pu être lu automatiquement."];

  const warnings: string[] = [];
  if (doc.type === "MEDICAL_CERTIFICATE") {
    if (ocr.isApte === false) {
      warnings.push(
        "Le certificat semble mentionner une contre-indication à la pratique.",
      );
    } else if (ocr.isApte !== true) {
      warnings.push(
        "La lecture automatique n’a pas confirmé l’aptitude à la pratique.",
      );
    }
    const date = ocr.date ? new Date(ocr.date) : null;
    if (!date || Number.isNaN(date.getTime())) {
      warnings.push("La date du certificat n’a pas pu être lue.");
    } else {
      const limit = new Date(now);
      limit.setMonth(limit.getMonth() - MEDICAL_CERTIFICATE_MAX_AGE_MONTHS);
      if (date < limit) {
        warnings.push(
          `Le certificat semble dater de plus de ${MEDICAL_CERTIFICATE_MAX_AGE_MONTHS} mois.`,
        );
      }
    }
  } else if (!ocr.licenseNumber?.trim()) {
    warnings.push("Le numéro de licence n’a pas pu être lu.");
  }
  return warnings;
}
