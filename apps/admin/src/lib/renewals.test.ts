import type { AdminLicenseRenewalDetailDto } from '../api/generated/types.gen';
import {
  documentViewer,
  ocrHints,
  prefilledLicenseNumber,
  readRenewalsParams,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
  reviewerLabel,
  writeRenewalsParams,
} from './renewals';

const detail = (overrides: Partial<AdminLicenseRenewalDetailDto> = {}) =>
  ({
    id: 'r1',
    status: 'PENDING',
    createdAt: '2026-10-01T10:00:00.000Z',
    submittedAt: '2026-10-01T10:05:00.000Z',
    reviewedAt: null,
    user: { id: 'u1', firstName: 'Eva', lastName: 'Martin', license: null },
    reviewedBy: null,
    rejectionReason: null,
    reviewComment: null,
    documents: [],
    renewsUntil: '2027-08-31T21:59:59.999Z',
    history: [],
    ...overrides,
  }) as unknown as AdminLicenseRenewalDetailDto;

describe('renewals URL state', () => {
  it('defaults to the pending tab, first page', () => {
    expect(readRenewalsParams(new URLSearchParams())).toEqual({ status: 'PENDING', page: 1 });
  });

  it('ignores an unknown status (DRAFT is not a tab) and a bad page', () => {
    expect(readRenewalsParams(new URLSearchParams('status=DRAFT&page=-2'))).toEqual({
      status: 'PENDING',
      page: 1,
    });
  });

  it('reads a decided tab and its page', () => {
    expect(readRenewalsParams(new URLSearchParams('status=REJECTED&page=3'))).toEqual({
      status: 'REJECTED',
      page: 3,
    });
  });

  it('goes back to the first page on a tab change, keeps defaults out of the URL', () => {
    const current = new URLSearchParams('status=APPROVED&page=3');
    expect(writeRenewalsParams(current, { status: 'PENDING' }).toString()).toBe('');
    expect(writeRenewalsParams(current, { page: 2 }).toString()).toBe('status=APPROVED&page=2');
  });
});

describe('REJECTION_REASONS', () => {
  it('labels every API code in French', () => {
    expect(REJECTION_REASONS).toEqual([
      'ILLEGIBLE',
      'INCOMPLETE',
      'CERTIFICATE_TOO_OLD',
      'NOT_A_MEDICAL_CERTIFICATE',
      'IDENTITY_MISMATCH',
      'LICENSE_MISMATCH',
      'MEDICAL_RESTRICTION',
      'OTHER',
    ]);
    for (const code of REJECTION_REASONS) expect(REJECTION_REASON_LABELS[code]).toBeTruthy();
  });
});

describe('ocrHints', () => {
  it('has nothing to say without a reading', () => {
    expect(ocrHints(null)).toEqual([]);
    expect(ocrHints({})).toEqual([]);
  });

  it('reports what was read, never a verdict', () => {
    const hints = ocrHints({
      isApte: true,
      date: '2026-09-15',
      doctorName: 'Dr Durand',
      licenseNumber: 'FFD-123',
      expiryDate: '2027-08-31',
    });
    expect(hints).toEqual([
      { label: 'Mention « apte »', value: 'lue sur le document' },
      { label: 'Date lue', value: '15/09/2026' },
      { label: 'Médecin lu', value: 'Dr Durand' },
      { label: 'Numéro de licence lu', value: 'FFD-123' },
      { label: "Date d'expiration lue", value: '31/08/2027' },
    ]);
    const text = JSON.stringify(hints).toLowerCase();
    for (const verdict of ['valide', 'invalide', 'accepté', 'refusé', 'conforme']) {
      expect(text).not.toContain(verdict);
    }
  });

  it('says when « apte » was not read, and keeps an unparsable date as read', () => {
    expect(ocrHints({ isApte: false, date: 'quinze septembre' })).toEqual([
      { label: 'Mention « apte »', value: 'non lue sur le document' },
      { label: 'Date lue', value: 'quinze septembre' },
    ]);
  });
});

describe('prefilledLicenseNumber', () => {
  const doc = (type: string, licenseNumber?: string) => ({
    id: `${type}-${licenseNumber}`,
    type,
    createdAt: '2026-10-01T10:00:00.000Z',
    ocr: licenseNumber ? { licenseNumber } : null,
  });

  it('prefers the number read on the licence certificate', () => {
    const r = detail({
      documents: [doc('MEDICAL_CERTIFICATE', 'MED-1'), doc('LICENSE_CERTIFICATE', 'LIC-2')],
      user: {
        id: 'u1',
        firstName: 'Eva',
        lastName: 'Martin',
        license: { number: 'OLD-3', validUntil: '2026-08-31T00:00:00.000Z' },
      },
    } as never);
    expect(prefilledLicenseNumber(r)).toBe('LIC-2');
  });

  it('falls back to any reading, then to the current licence, then to nothing', () => {
    expect(
      prefilledLicenseNumber(detail({ documents: [doc('MEDICAL_CERTIFICATE', 'MED-1')] } as never)),
    ).toBe('MED-1');
    expect(
      prefilledLicenseNumber(
        detail({
          documents: [doc('LICENSE_CERTIFICATE')],
          user: {
            id: 'u1',
            firstName: 'Eva',
            lastName: 'Martin',
            license: { number: 'OLD-3', validUntil: '2026-08-31T00:00:00.000Z' },
          },
        } as never),
      ),
    ).toBe('OLD-3');
    expect(prefilledLicenseNumber(detail())).toBe('');
  });

  it('never exceeds the API bound', () => {
    const long = 'A'.repeat(40);
    expect(
      prefilledLicenseNumber(detail({ documents: [doc('LICENSE_CERTIFICATE', long)] } as never)),
    ).toHaveLength(32);
  });
});

describe('documentViewer', () => {
  it('shows only the uploaded types', () => {
    expect(documentViewer('image/jpeg')).toBe('image');
    expect(documentViewer('image/png')).toBe('image');
    expect(documentViewer('application/pdf')).toBe('pdf');
    expect(documentViewer('Application/PDF; charset=binary')).toBe('pdf');
  });

  it('never renders anything else in the back-office origin', () => {
    expect(documentViewer('text/html')).toBeNull();
    expect(documentViewer('image/svg+xml')).toBeNull();
    expect(documentViewer('application/octet-stream')).toBeNull();
    expect(documentViewer('')).toBeNull();
  });
});

describe('reviewerLabel', () => {
  it('names the admin, the automatic approval, or nobody', () => {
    expect(
      reviewerLabel({ status: 'REJECTED', reviewedBy: { firstName: 'Gabin', lastName: 'S' } }),
    ).toBe('Gabin S');
    expect(reviewerLabel({ status: 'APPROVED', reviewedBy: null })).toBe('Approbation automatique');
    expect(reviewerLabel({ status: 'REJECTED', reviewedBy: null })).toBe('—');
  });
});
