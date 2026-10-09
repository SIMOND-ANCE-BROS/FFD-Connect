import { apiErrorMessage, isConflict } from './apiError';

describe('apiErrorMessage', () => {
  it('returns a string message', () => {
    expect(apiErrorMessage({ message: 'Email déjà utilisé' }, 'x')).toBe('Email déjà utilisé');
  });
  it('joins a validation array', () => {
    expect(apiErrorMessage({ message: ['a', 'b'] }, 'x')).toBe('a, b');
  });
  it('falls back on anything else', () => {
    expect(apiErrorMessage(null, 'Création impossible')).toBe('Création impossible');
    expect(apiErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
  });
  it('translates a network failure (TypeError) into French', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe(
      'Serveur injoignable, réessayez dans un instant.',
    );
  });
});

describe('isConflict', () => {
  it('recognises a 409 error body', () => {
    expect(isConflict({ statusCode: 409, message: 'Cette proposition a déjà été traitée.' })).toBe(
      true,
    );
  });
  it('is false for anything else', () => {
    expect(isConflict({ statusCode: 400 })).toBe(false);
    expect(isConflict(new TypeError('Failed to fetch'))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});
