import { BadRequestException } from "@nestjs/common";

/**
 * A 400 whose user-facing text must never reach the logs (#225).
 *
 * Some refusals carry personal data in their message: "your medical
 * certificate says you are unfit" is health data (GDPR art. 9) and, once
 * logged next to the request URL, it is tied to a renewal request. The text
 * still goes to the user, but every log path only ever sees a code:
 *
 * - the response body keeps `message` (shown by the app) and adds `code`,
 *   the fine-grained reason the client may branch on;
 * - the logs see `logCode` instead. It defaults to `code`, but a caller whose
 *   fine code is itself sensitive (`MEDICAL_UNFIT` reveals fitness) passes a
 *   neutral one shared by several reasons;
 * - `Error.message` (read by `LoggingInterceptor`, Sentry and the stack
 *   trace header) is `logCode`, never the text nor the fine code;
 * - `HttpExceptionFilter` logs `logCode` instead of `message`.
 */
export class CodedBadRequestException extends BadRequestException {
  public readonly logCode: string;

  constructor(
    public readonly code: string,
    userMessage: string,
    logCode: string = code,
  ) {
    super({
      message: userMessage,
      error: "Bad Request",
      statusCode: 400,
      code,
    });
    this.logCode = logCode;
    // HttpException copies the body's `message` into `Error.message`; the
    // stack header is formatted lazily from it, so overriding here keeps the
    // user text out of both.
    this.message = logCode;
  }
}

/**
 * The code the logs may show for an exception: the neutral `logCode` of a
 * `CodedBadRequestException`, else the `code` of its body, if any.
 */
export function logCodeOf(
  exception: unknown,
  body: unknown,
): string | undefined {
  if (exception instanceof CodedBadRequestException) return exception.logCode;
  return errorCodeOf(body);
}

/** Stable code of an HTTP error body, when the thrower set one. */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}
