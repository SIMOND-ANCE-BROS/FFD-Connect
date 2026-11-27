import { ForbiddenException } from "@nestjs/common";

/**
 * `code` of a request refused because the current password the user typed
 * to confirm it (account deletion, password change) is wrong (#937).
 */
export const WRONG_PASSWORD_CODE = "WRONG_PASSWORD";

/**
 * A wrong confirmation password is a 403, not a 401: the app reads a 401 as
 * an expired access token and refreshes the session (rotating the refresh
 * token for nothing), while the session is valid here. The code tells it
 * apart from the other 403s of these routes (impersonation, store review).
 */
export function wrongPasswordRefusal(message: string): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: "Forbidden",
    message,
    code: WRONG_PASSWORD_CODE,
  });
}
