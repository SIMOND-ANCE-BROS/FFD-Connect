import {
  decidedByPhrase,
  initialLicenseNumber,
  listFilter,
  readRenewalParams,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
  reviewerLabel,
  writeRenewalParams,
} from './licenseRenewals';

describe('renewal URL params', () => {
  it('defaults to the « À traiter » tab, first page', () => {
    expect(readRenewalParams(new URLSearchParams())).toEqual({
      status: 'PENDING',
      page: 1,
      sort: null,
    });
    expect(readRenewalParams(new URLSearchParams('status=DRAFT&page=-1&sort=email'))).toEqual({
      status: 'PENDING',
      page: 1,
      sort: null,
    });
  });

  it('reads and writes the decided tabs and the page', () => {
    const params = new URLSearchParams('status=REJECTED&page=3');
    expect(readRenewalParams(params)).toEqual({ status: 'REJECTED', page: 3, sort: null });
    expect(writeRenewalParams(params, { page: 4 }).toString()).toBe('status=REJECTED&page=4');
  });

  it('a tab change goes back to the first page; defaults stay out of the URL', () => {
    const params = new URLSearchParams('status=APPROVED&page=2');
    expect(writeRenewalParams(params, { status: 'PENDING' }).toString()).toBe('');
  });

  it('keeps a column sort in the URL, from the first page', () => {
    const params = new URLSearchParams('status=APPROVED&page=2');
    const next = writeRenewalParams(params, { sort: { by: 'reviewedAt', order: 'desc' } });
    expect(next.toString()).toBe('status=APPROVED&sort=reviewedAt&order=desc');
    expect(readRenewalParams(next).sort).toEqual({ by: 'reviewedAt', order: 'desc' });
  });

  it('builds the API filter of one page', () => {
    expect(listFilter({ status: 'APPROVED', page: 2, sort: null }, 50)).toEqual({
      status: 'APPROVED',
      skip: 50,
      take: 50,
    });
    expect(
      listFilter({ status: 'PENDING', page: 1, sort: { by: 'name', order: 'asc' } }, 50),
    ).toEqual({ status: 'PENDING', sortBy: 'name', sortOrder: 'asc', skip: 0, take: 50 });
  });
});

describe('rejection reasons', () => {
  it('labels every API code, in the API order', () => {
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
    for (const reason of REJECTION_REASONS) {
      expect(REJECTION_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe('initialLicenseNumber', () => {
  const doc = (licenseNumber?: string) => ({
    id: 'd1',
    type: 'LICENSE_CERTIFICATE' as const,
    createdAt: '2026-10-08T09:00:00.000Z',
    ocr: licenseNumber ? { licenseNumber } : {},
  });

  it('keeps the current licence number first: an OCR misread never replaces it silently', () => {
    expect(initialLicenseNumber([doc('FFD-777')], { number: 'FFD-1', validUntil: '' })).toBe(
      'FFD-1',
    );
  });

  it('falls back to the number read on the certificate, then to empty', () => {
    expect(initialLicenseNumber([doc('FFD-777')], null)).toBe('FFD-777');
    expect(initialLicenseNumber([doc()], null)).toBe('');
    expect(initialLicenseNumber([], null)).toBe('');
  });
});

describe('who decided (#524)', () => {
  const admin = { id: 'a1', firstName: 'Gabin', lastName: 'S' };

  it('names the administrator who decided', () => {
    const r = { reviewedBy: admin, decidedAutomatically: false };
    expect(reviewerLabel(r)).toBe('Gabin S');
    expect(decidedByPhrase(r)).toBe('Gabin S');
  });

  it('an automatic approval from before #271', () => {
    const r = { reviewedBy: null, decidedAutomatically: true };
    expect(reviewerLabel(r)).toBe('Validation automatique');
    expect(decidedByPhrase(r)).toBe('la validation automatique');
  });

  it('a decision whose administrator was deleted since is never automatic', () => {
    const r = { reviewedBy: null, decidedAutomatically: false };
    expect(reviewerLabel(r)).toBe('Administrateur supprimé');
    expect(decidedByPhrase(r)).toBe('un administrateur supprimé');
  });
});
