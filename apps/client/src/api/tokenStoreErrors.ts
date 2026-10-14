/**
 * Typed failure of a token READ (#582).
 *
 * Reading the Keychain / Keystore can fail while the session is perfectly
 * valid — typically iOS refusing access to an item while the iPhone is locked
 * (`errSecInteractionNotAllowed`, "User interaction is not allowed"). Such a
 * failure must NEVER be read as "no session": no logout, no clearTokens, no
 * redirect to login. Callers abort the request quietly and let the next
 * attempt (app back in foreground / device unlocked) go through.
 *
 * Kept in a dependency-free module so the logger and the HTTP layers can
 * recognise it without importing expo-secure-store.
 */
export class TokenStoreUnavailableError extends Error {
  /** True when the OS refused the read because the device is locked. */
  readonly locked: boolean;

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Secure token store unavailable: ${detail}`);
    this.name = "TokenStoreUnavailableError";
    this.locked = isDeviceLockedError(cause);
  }
}

/** iOS Keychain refusal while the device is locked (errSecInteractionNotAllowed). */
export function isDeviceLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /interaction is not allowed|errSecInteractionNotAllowed|-25308/i.test(
    message,
  );
}

/**
 * Structural check (not only `instanceof`): survives module duplication and
 * test mocks of the token store.
 */
export function isTokenStoreUnavailable(
  error: unknown,
): error is TokenStoreUnavailableError {
  return (
    error instanceof TokenStoreUnavailableError ||
    (error instanceof Error && error.name === "TokenStoreUnavailableError")
  );
}
