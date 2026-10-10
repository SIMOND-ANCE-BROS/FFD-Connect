import {
  initialLicenseNumber,
  listFilter,
  readRenewalParams,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
  writeRenewalParams,
} from './licenseRenewals';

describe('renewal URL params', () => {
  it('defaults to the « À traiter » tab, first page', () => {
    expect(readRenewalParams(new URLSearchParams())).toEqual({ status: 'PENDING', page: 1 });
    expect(readRenewalParams(new URLSearchParams('status=DRAFT&page=-1'))).toEqual({
      status: 'PENDING',
      page: 1,
    });
  });

  it('reads and writes the decided tabs and the page', () => {
    const params = new URLSearchParams('status=REJECTED&page=3');
    expect(readRenewalParams(params)).toEqual({ status: 'REJECTED', page: 3 });
    expect(writeRenewalParams(params, { page: 4 }).toString()).toBe('status=REJECTED&page=4');
  });

  it('a tab change goes back to the first page; defaults stay out of the URL', () => {
    const params = new URLSearchParams('status=APPROVED&page=2');
    expect(writeRenewalParams(params, { status: 'PENDING' }).toString()).toBe('');
  });

  it('builds the API filter of one page', () => {
    expect(listFilter({ status: 'APPROVED', page: 2 }, 50)).toEqual({
      status: 'APPROVED',
      skip: 50,
      take: 50,
    });
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

  it('prefills the number read on the licence certificate', () => {
    expect(initialLicenseNumber([doc('FFD-777')], { number: 'FFD-1', validUntil: '' })).toBe(
      'FFD-777',
    );
  });

  it('falls back to the current licence, then to empty', () => {
    expect(initialLicenseNumber([doc()], { number: 'FFD-1', validUntil: '' })).toBe('FFD-1');
    expect(initialLicenseNumber([doc()], null)).toBe('');
    expect(initialLicenseNumber([], null)).toBe('');
  });
});
