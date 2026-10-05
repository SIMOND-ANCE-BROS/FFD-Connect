/**
 * Utilitaires pour la gestion type-safe des erreurs
 */

/**
 * Extrait un message d'erreur de manière type-safe depuis une erreur inconnue
 *
 * @param error - L'erreur à traiter (peut être de n'importe quel type)
 * @returns Le message d'erreur sous forme de string
 *
 * @example
 * ```typescript
 * try {
 *   // code qui peut échouer
 * } catch (error: unknown) {
 *   const message = getErrorMessage(error);
 *   logger.error(message);
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}

/**
 * Extrait la stack trace d'une erreur de manière type-safe
 *
 * @param error - L'erreur à traiter
 * @returns La stack trace si disponible, undefined sinon
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

/**
 * Vérifie si une valeur est une instance d'Error
 *
 * @param error - La valeur à vérifier
 * @returns true si c'est une instance d'Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Extrait le code d'erreur d'une erreur inconnue de manière type-safe.
 *
 * Les SDK (firebase-admin, Azure…) exposent un `code` string sur leurs erreurs
 * (ex. `messaging/registration-token-not-registered`) sans forcément dériver
 * d'une classe exportée : on lit la propriété défensivement.
 *
 * @param error - L'erreur à traiter
 * @returns Le code si présent et de type string, undefined sinon
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
