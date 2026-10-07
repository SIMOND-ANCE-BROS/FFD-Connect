import { apiErrorMessage } from './apiError';

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
    expect(apiErrorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('Failed to fetch');
  });
});
