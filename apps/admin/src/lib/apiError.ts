export const UNAVAILABLE_MESSAGE = 'Serveur injoignable, réessayez dans un instant.';

/** Message of a parsed NestJS error body (string or validation array), or the fallback. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  // The generated client never throws: a rejected fetch surfaces as a TypeError.
  if (body instanceof TypeError) return UNAVAILABLE_MESSAGE;
  if (typeof body !== 'object' || body === null) return fallback;
  const { message } = body as { message?: unknown };
  const text = Array.isArray(message)
    ? message.filter((m): m is string => typeof m === 'string').join(', ')
    : message;
  return typeof text === 'string' && text ? text : fallback;
}

/** True for a 409 error body (the backend's global filter always sets statusCode). */
export function isConflict(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 409
  );
}
