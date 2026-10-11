import { ForbiddenException } from "@nestjs/common";

export type ProtectedAction = "delete" | "disable";

const VERB: Record<ProtectedAction, string> = {
  delete: "supprimé",
  disable: "désactivé",
};

/** Shown as is by the back-office. */
export const storeReviewUserMessage = (action: ProtectedAction): string =>
  `Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être ${VERB[action]}.`;

export const storeReviewClubMessage = (action: ProtectedAction): string =>
  `Ce club est utilisé pour les validations App Store / Google Play : il ne peut pas être ${VERB[action]}.`;

/**
 * The store-review account and its club stay editable but can be neither
 * deleted nor disabled: a missing or disabled review account gets the app
 * rejected by Apple / Google.
 */
export function assertUserNotStoreReview(
  user: { isStoreReview?: boolean | null } | null | undefined,
  action: ProtectedAction,
): void {
  if (user?.isStoreReview) {
    throw new ForbiddenException(storeReviewUserMessage(action));
  }
}

export function assertClubNotStoreReview(
  club: { isStoreReview?: boolean | null } | null | undefined,
  action: ProtectedAction,
): void {
  if (club?.isStoreReview) {
    throw new ForbiddenException(storeReviewClubMessage(action));
  }
}

/** POST /auth/impersonate by the store-review account. */
export const STORE_REVIEW_IMPERSONATION_MESSAGE =
  "Le compte de démonstration ne peut pas se connecter en tant qu'un autre utilisateur.";
