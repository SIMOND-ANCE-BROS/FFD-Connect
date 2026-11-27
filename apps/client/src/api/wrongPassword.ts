/**
 * `code` of the 403 the backend answers when the current password typed to
 * confirm an action (account deletion, password change) is wrong (#937).
 * A 403, not a 401: the session is valid, so nothing must refresh it.
 */
const WRONG_PASSWORD_CODE = "WRONG_PASSWORD";

/** Whether an error response is the backend's wrong-password refusal. */
export function isWrongPasswordRefusal(
  status: number | undefined,
  data: unknown,
): boolean {
  return (
    status === 403 &&
    typeof data === "object" &&
    data !== null &&
    (data as { code?: unknown }).code === WRONG_PASSWORD_CODE
  );
}
