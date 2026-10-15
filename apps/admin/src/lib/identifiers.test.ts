import { identifiersChanges, validateEmail, validateLicenseNumber } from './identifiers';

const user0 = { email: 'jeanne@x.fr', licenseNumber: 'FFD-1' };

describe('identifiersChanges', () => {
  it('keeps only what changes, the email normalised and compared case-insensitively', () => {
    expect(identifiersChanges(user0, { email: ' Jeanne@X.fr ', licenseNumber: 'FFD-1' })).toEqual(
      {},
    );
    expect(identifiersChanges(user0, { email: ' New@X.fr', licenseNumber: ' FFD-2 ' })).toEqual({
      email: 'new@x.fr',
      licenseNumber: 'FFD-2',
    });
  });

  it('leaves out an identifier that is not given', () => {
    expect(identifiersChanges(user0, { licenseNumber: 'FFD-2' })).toEqual({
      licenseNumber: 'FFD-2',
    });
    expect(identifiersChanges(user0, { email: 'new@x.fr' })).toEqual({ email: 'new@x.fr' });
  });

  it('never sends a licence number for an account without licence', () => {
    expect(
      identifiersChanges(
        { ...user0, licenseNumber: null },
        { email: 'jeanne@x.fr', licenseNumber: 'X' },
      ),
    ).toEqual({});
  });
});

describe('validators', () => {
  it('accepts a well-formed email only', () => {
    expect(validateEmail(' a@b.fr ')).toBeNull();
    expect(validateEmail('pas-un-email')).toBe('Adresse email invalide');
  });

  it('requires a licence number, caps its length and its characters', () => {
    expect(validateLicenseNumber('FFD-2/3 .A')).toBeNull();
    expect(validateLicenseNumber('  ')).toBe('Obligatoire');
    expect(validateLicenseNumber('1'.repeat(33))).toBe('32 caractères au plus');
    expect(validateLicenseNumber('FFD<1>')).toMatch(/Lettres, chiffres/);
  });
});
