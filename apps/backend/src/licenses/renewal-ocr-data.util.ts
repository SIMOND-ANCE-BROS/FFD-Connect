import { LicenseRenewalDocumentType } from "@prisma/client";

/**
 * What a renewal document keeps — and exposes — of its OCR result (#224).
 *
 * The OCR used to hand back `rawText`, the first 500 characters of the medical
 * certificate (health data, GDPR art. 9), which was stored in `ocrData` and
 * returned by every renewal route. Only these parsed fields are ever needed:
 *
 * - medical certificate: `isApte` and `date` (renewal rules, purge deadline),
 *   `doctorName` (summary shown in the app);
 * - licence certificate: `licenseNumber` (renewal rules), `expiryDate`
 *   (summary shown in the app).
 *
 * The same whitelist filters what is written AND what is read back, so rows
 * stored before the fix never leak either, whatever they contain.
 */
export interface RenewalOcrData {
  isApte?: boolean;
  date?: string;
  doctorName?: string;
  licenseNumber?: string;
  expiryDate?: string;
}

const STRING_FIELDS: Record<
  LicenseRenewalDocumentType,
  readonly (keyof RenewalOcrData)[]
> = {
  [LicenseRenewalDocumentType.MEDICAL_CERTIFICATE]: ["date", "doctorName"],
  [LicenseRenewalDocumentType.LICENSE_CERTIFICATE]: [
    "licenseNumber",
    "expiryDate",
  ],
};

/**
 * Keeps only the whitelisted, correctly typed fields of an OCR result for a
 * document type. Anything else — `rawText` first — is dropped.
 */
export function pickRenewalOcrData(
  type: LicenseRenewalDocumentType,
  ocrData: unknown,
): RenewalOcrData | null {
  if (typeof ocrData !== "object" || ocrData === null || Array.isArray(ocrData))
    return null;
  const source = ocrData as Record<string, unknown>;
  const picked: Record<string, string | boolean> = {};
  if (
    type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE &&
    typeof source.isApte === "boolean"
  ) {
    picked.isApte = source.isApte;
  }
  for (const field of STRING_FIELDS[type]) {
    const value = source[field];
    if (typeof value === "string") picked[field] = value;
  }
  return picked;
}

interface DocumentWithOcrData {
  type: LicenseRenewalDocumentType;
  ocrData: unknown;
}

type SanitizedDocument<T extends DocumentWithOcrData> = Omit<T, "ocrData"> & {
  ocrData: RenewalOcrData | null;
};

/** A renewal document as the API returns it: OCR data whitelisted. */
export function toRenewalDocumentResponse<T extends DocumentWithOcrData>(
  document: T,
): SanitizedDocument<T> {
  return {
    ...document,
    ocrData: pickRenewalOcrData(document.type, document.ocrData),
  };
}

/** A renewal request as the API returns it: every document sanitized. */
export function toRenewalRequestResponse<
  T extends { documents: DocumentWithOcrData[] },
>(
  request: T,
): Omit<T, "documents"> & {
  documents: SanitizedDocument<T["documents"][number]>[];
} {
  return {
    ...request,
    documents: request.documents.map((document) =>
      toRenewalDocumentResponse(document),
    ),
  };
}
