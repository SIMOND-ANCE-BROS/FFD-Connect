import { protectedActionError, storeReviewMessage } from './storeReview';

describe('storeReviewMessage', () => {
  it('matches the API wording for a user and a club', () => {
    expect(storeReviewMessage('user', 'delete')).toBe(
      'Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.',
    );
    expect(storeReviewMessage('club', 'disable')).toBe(
      'Ce club est utilisé pour les validations App Store / Google Play : il ne peut pas être désactivé.',
    );
  });
});

describe('protectedActionError', () => {
  const opts = { isStoreReview: true, target: 'user', action: 'delete' } as const;

  it('keeps the server message of a 403', () => {
    expect(protectedActionError({ statusCode: 403, message: 'Refusé' }, opts, 'x')).toBe('Refusé');
  });

  it('falls back on the store-review message for a bare 403', () => {
    expect(protectedActionError({ statusCode: 403 }, opts, 'x')).toBe(
      storeReviewMessage('user', 'delete'),
    );
  });

  it('uses the generic fallback for other errors or other accounts', () => {
    expect(protectedActionError({ statusCode: 500 }, opts, 'Suppression impossible')).toBe(
      'Suppression impossible',
    );
    expect(
      protectedActionError({ statusCode: 403 }, { ...opts, isStoreReview: false }, 'Refus'),
    ).toBe('Refus');
  });
});
