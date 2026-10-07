/** Message of a parsed NestJS error body (string or validation array), or the fallback. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const { message } = body as { message?: unknown };
  const text = Array.isArray(message)
    ? message.filter((m): m is string => typeof m === 'string').join(', ')
    : message;
  return typeof text === 'string' && text ? text : fallback;
}
