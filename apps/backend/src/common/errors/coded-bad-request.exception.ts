import { BadRequestException } from "@nestjs/common";

/**
 * A 400 whose user-facing text must never reach the logs (#225).
 *
 * Some refusals carry personal data in their message: "your medical
 * certificate says you are unfit" is health data (GDPR art. 9) and, once
 * logged next to the request URL, it is tied to a renewal request. The text
 * still goes to the user, but every log path only ever sees a stable code:
 *
 * - the response body keeps `message` (shown by the app) and adds `code`;
 * - `Error.message` — read by `LoggingInterceptor`, Sentry and the stack
 *   trace header — is the code, not the text;
 * - `HttpExceptionFilter` logs `code` instead of `message` when one is set.
 */
export class CodedBadRequestException extends BadRequestException {
  constructor(
    public readonly code: string,
    userMessage: string,
  ) {
    super({
      message: userMessage,
      error: "Bad Request",
      statusCode: 400,
      code,
    });
    // HttpException copies the body's `message` into `Error.message`; the
    // stack header is formatted lazily from it, so overriding here keeps the
    // user text out of both.
    this.message = code;
  }
}

/** Stable code of an HTTP error body, when the thrower set one. */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}
