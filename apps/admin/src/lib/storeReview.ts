import { apiErrorMessage } from './apiError';

/**
 * The account (and its club) handed to Apple / Google reviewers. It stays
 * editable but can be neither deleted nor disabled: the back-office explains
 * it up front and the API refuses with a 403 anyway.
 */
export const STORE_REVIEW_LABEL = 'Compte de validation App Store / Google Play';

export type StoreReviewTarget = 'user' | 'club';
export type ProtectedAction = 'delete' | 'disable';

const SUBJECT: Record<StoreReviewTarget, string> = {
  user: 'Ce compte',
  club: 'Ce club',
};

const VERB: Record<ProtectedAction, string> = {
  delete: 'supprimé',
  disable: 'désactivé',
};

/** Same wording as the API refusal (store-review-protection.ts). */
export function storeReviewMessage(target: StoreReviewTarget, action: ProtectedAction): string {
  return `${SUBJECT[target]} est utilisé pour les validations App Store / Google Play : il ne peut pas être ${VERB[action]}.`;
}

function isForbidden(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 403
  );
}

/**
 * Error message for a delete / disable call. When the target is the
 * store-review account a 403 always reads as the store-review refusal, even
 * if the body carries no usable message.
 */
export function protectedActionError(
  body: unknown,
  opts: { isStoreReview: boolean; target: StoreReviewTarget; action: ProtectedAction },
  fallback: string,
): string {
  if (opts.isStoreReview && isForbidden(body)) {
    return apiErrorMessage(body, storeReviewMessage(opts.target, opts.action));
  }
  return apiErrorMessage(body, fallback);
}
