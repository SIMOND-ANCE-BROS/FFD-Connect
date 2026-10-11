import type {
  AdminLicenseRenewalDetailDto,
  AdminRenewalDocumentDetailDto,
  AdminRenewalLicenseDto,
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from '../api/generated/types.gen';
import type { LicenseRenewalsFilter } from '../api/queries';

/** Tabs of the queue: a draft is never shown (the licensee has not submitted it). */
export type RenewalTab = Extract<LicenseRenewalStatus, 'PENDING' | 'APPROVED' | 'REJECTED'>;

export const TAB_OPTIONS: { value: RenewalTab; label: string }[] = [
  { value: 'PENDING', label: 'À traiter' },
  { value: 'APPROVED', label: 'Approuvées' },
  { value: 'REJECTED', label: 'Refusées' },
];

export const STATUS_BADGES: Record<LicenseRenewalStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Brouillon', color: 'gray' },
  PENDING: { label: 'À traiter', color: 'yellow' },
  APPROVED: { label: 'Approuvée', color: 'green' },
  REJECTED: { label: 'Refusée', color: 'red' },
};

export const DOCUMENT_LABELS: Record<LicenseRenewalDocumentType, string> = {
  MEDICAL_CERTIFICATE: 'Certificat médical',
  LICENSE_CERTIFICATE: 'Attestation de licence',
};

export type RejectionReason = NonNullable<AdminLicenseRenewalDetailDto['rejectionReason']>;

/** Same codes and order as the API (RENEWAL_REJECTION_REASONS). */
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  ILLEGIBLE: 'Document illisible',
  INCOMPLETE: 'Document incomplet',
  CERTIFICATE_TOO_OLD: 'Certificat trop ancien',
  NOT_A_MEDICAL_CERTIFICATE: "Ce n'est pas un certificat médical",
  IDENTITY_MISMATCH: "L'identité ne correspond pas",
  LICENSE_MISMATCH: 'La licence ne correspond pas',
  MEDICAL_RESTRICTION: 'Contre-indication médicale',
  OTHER: 'Autre motif',
};

export const REJECTION_REASONS = Object.keys(REJECTION_REASON_LABELS) as RejectionReason[];

/** Same bound as the API. */
export const COMMENT_MAX_LENGTH = 500;

export interface RenewalsUrlState {
  status: RenewalTab;
  page: number;
}

const isTab = (value: string | null): value is RenewalTab =>
  TAB_OPTIONS.some((o) => o.value === value);

/** Filter kept in the URL: `?status=REJECTED&page=2` (defaults omitted). */
export function readRenewalParams(params: URLSearchParams): RenewalsUrlState {
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    status: isTab(status) ? status : 'PENDING',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; a tab change goes back to the first page. */
export function writeRenewalParams(
  current: URLSearchParams,
  patch: Partial<RenewalsUrlState>,
): URLSearchParams {
  const next = { ...readRenewalParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.status !== 'PENDING') params.set('status', next.status);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

export const listFilter = (state: RenewalsUrlState, take: number): LicenseRenewalsFilter => ({
  status: state.status,
  skip: (state.page - 1) * take,
  take,
});

/**
 * Number the approval form starts from: the current licence's first (a
 * number sent to the API REPLACES it, so an OCR misread must never be the
 * default), else the one read on the licence certificate. The admin confirms
 * or corrects it; the OCR reading stays visible as a hint.
 */
export function initialLicenseNumber(
  documents: Pick<AdminRenewalDocumentDetailDto, 'type' | 'ocr'>[],
  license: AdminRenewalLicenseDto | null,
): string {
  if (license?.number) return license.number;
  const read = documents.find((d) => d.type === 'LICENSE_CERTIFICATE')?.ocr?.licenseNumber;
  return read?.trim() ?? '';
}

/**
 * 409 of an approval whose number is another account's licence (the API has
 * no error code: its message is the only discriminant), as opposed to the 409
 * of a request already decided.
 */
export const isLicenseNumberTaken = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  (body as { statusCode?: unknown }).statusCode === 409 &&
  /numéro de licence/i.test(String((body as { message?: unknown }).message ?? ''));
