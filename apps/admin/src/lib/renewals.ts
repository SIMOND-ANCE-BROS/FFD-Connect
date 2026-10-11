import dayjs from 'dayjs';
import type {
  AdminLicenseRenewalDetailDto,
  AdminRenewalOcrHintsDto,
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  RejectLicenseRenewalDto,
} from '../api/generated/types.gen';

export type RenewalTab = Extract<LicenseRenewalStatus, 'PENDING' | 'APPROVED' | 'REJECTED'>;
export type RenewalRejectionReason = RejectLicenseRenewalDto['reason'];

export const RENEWAL_TABS: { value: RenewalTab; label: string }[] = [
  { value: 'PENDING', label: 'À traiter' },
  { value: 'APPROVED', label: 'Approuvées' },
  { value: 'REJECTED', label: 'Refusées' },
];

export const RENEWAL_STATUS_BADGES: Record<LicenseRenewalStatus, { label: string; color: string }> =
  {
    DRAFT: { label: 'Brouillon', color: 'gray' },
    PENDING: { label: 'À traiter', color: 'yellow' },
    APPROVED: { label: 'Approuvée', color: 'green' },
    REJECTED: { label: 'Refusée', color: 'red' },
  };

/** Same codes as the API (RENEWAL_REJECTION_REASONS), in its order. */
export const REJECTION_REASON_LABELS: Record<RenewalRejectionReason, string> = {
  ILLEGIBLE: 'Document illisible',
  INCOMPLETE: 'Dossier incomplet',
  CERTIFICATE_TOO_OLD: 'Certificat trop ancien',
  NOT_A_MEDICAL_CERTIFICATE: "Le document n'est pas un certificat médical",
  IDENTITY_MISMATCH: "L'identité ne correspond pas",
  LICENSE_MISMATCH: 'Le numéro de licence ne correspond pas',
  MEDICAL_RESTRICTION: 'Restriction médicale',
  OTHER: 'Autre motif',
};

export const REJECTION_REASONS = Object.keys(REJECTION_REASON_LABELS) as RenewalRejectionReason[];

export const DOCUMENT_TYPE_LABELS: Record<LicenseRenewalDocumentType, string> = {
  MEDICAL_CERTIFICATE: 'Certificat médical',
  LICENSE_CERTIFICATE: 'Attestation de licence',
};

/** Shown next to the rejection comment: health data must never be typed there. */
export const NO_MEDICAL_DETAIL_WARNING =
  'Ne saisissez aucun détail médical : ce commentaire est transmis au licencié.';

/** Same bounds as the API (RENEWAL_REVIEW_COMMENT_MAX_LENGTH, LICENSE_NUMBER_MAX_LENGTH). */
export const REVIEW_COMMENT_MAX_LENGTH = 500;
export const LICENSE_NUMBER_MAX_LENGTH = 32;

const isTab = (value: string | null): value is RenewalTab =>
  RENEWAL_TABS.some((t) => t.value === value);

export interface RenewalsUrlState {
  status: RenewalTab;
  page: number;
}

/** Tab and page kept in the URL: `?status=APPROVED&page=2`. */
export function readRenewalsParams(params: URLSearchParams): RenewalsUrlState {
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    status: isTab(status) ? status : 'PENDING',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; a tab change goes back to the first page. */
export function writeRenewalsParams(
  current: URLSearchParams,
  patch: Partial<RenewalsUrlState>,
): URLSearchParams {
  const next = { ...readRenewalsParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.status !== 'PENDING') params.set('status', next.status);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** A date as read (day only, local): an unparsable reading is shown as is. */
const formatOcrDate = (value: string): string => {
  const date = dayjs(value);
  return date.isValid() ? date.format('DD/MM/YYYY') : value;
};

/**
 * What the OCR read on a document, as hints to check against the file: never
 * a verdict. « apte » is reported as text found (or not) on the document.
 */
export function ocrHints(ocr: AdminRenewalOcrHintsDto | null): { label: string; value: string }[] {
  if (!ocr) return [];
  const hints: { label: string; value: string }[] = [];
  if (ocr.isApte !== undefined) {
    hints.push({
      label: 'Mention « apte »',
      value: ocr.isApte ? 'lue sur le document' : 'non lue sur le document',
    });
  }
  if (ocr.date) hints.push({ label: 'Date lue', value: formatOcrDate(ocr.date) });
  if (ocr.doctorName) hints.push({ label: 'Médecin lu', value: ocr.doctorName });
  if (ocr.licenseNumber) hints.push({ label: 'Numéro de licence lu', value: ocr.licenseNumber });
  if (ocr.expiryDate) {
    hints.push({ label: "Date d'expiration lue", value: formatOcrDate(ocr.expiryDate) });
  }
  return hints;
}

/**
 * Pre-fill of the licence number field, for the admin to check and confirm:
 * the number read on the licence certificate, else on any document, else the
 * current licence's. The API keeps the final say (it rejects an unknown or
 * taken number).
 */
export function prefilledLicenseNumber(renewal: AdminLicenseRenewalDetailDto): string {
  const read = (type?: LicenseRenewalDocumentType) =>
    renewal.documents.find((d) => (!type || d.type === type) && d.ocr?.licenseNumber)?.ocr
      ?.licenseNumber;
  return (read('LICENSE_CERTIFICATE') ?? read() ?? renewal.user.license?.number ?? '').slice(
    0,
    LICENSE_NUMBER_MAX_LENGTH,
  );
}

/**
 * How a fetched document file is shown: only the types the API accepts on
 * upload. Anything else (e.g. HTML) is never rendered in the back-office
 * origin.
 */
export function documentViewer(contentType: string): 'image' | 'pdf' | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/jpeg' || type === 'image/png') return 'image';
  if (type === 'application/pdf') return 'pdf';
  return null;
}

export const fullName = (p: { firstName: string; lastName: string }): string =>
  `${p.firstName} ${p.lastName}`.trim();

/** Who decided: the admin, the automatic approval (no reviewer), or nobody yet. */
export function reviewerLabel(r: {
  status: LicenseRenewalStatus;
  reviewedBy: { firstName: string; lastName: string } | null;
}): string {
  if (r.reviewedBy) return fullName(r.reviewedBy);
  return r.status === 'APPROVED' ? 'Approbation automatique' : '—';
}
