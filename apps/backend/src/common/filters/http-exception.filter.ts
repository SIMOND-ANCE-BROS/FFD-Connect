import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { PinoLogger } from "nestjs-pino";
import { Request, Response } from "express";
import {
  redactSecretsDeep,
  redactSecretsInText,
  redactUrl,
} from "../logger/redact-url";
import { errorCodeOf, logCodeOf } from "../errors/coded-bad-request.exception";

/**
 * Filtre global d'exceptions HTTP pour une gestion cohérente des erreurs
 *
 * Ce filtre intercepte toutes les exceptions levées dans l'application
 * et retourne une réponse standardisée avec un format cohérent.
 * Utilise Pino pour un logging structuré.
 */
/** 503 en littéral numérique : comparaison `number` pure, évite le lint
 * `no-unsafe-enum-comparison` (status est un number, pas un HttpStatus). */
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const HTTP_STATUS_CONFLICT = 409;
const CONFLICT_DETAIL_KEYS = [
  "existingClubId",
  "memberCount",
  "clubAccountCount",
  "competitionCount",
  "partnershipCount",
  "soloTeamCount",
  // Track library: the existing track of a duplicate import, and the pending
  // corrections that block a deletion.
  "existingTrackId",
  "pendingCorrections",
] as const;

/**
 * The logged shape of an error. With a log code, neither the message nor the
 * stack header ("Name: message", its first line) may carry the original text.
 */
function describeError(
  exception: Error,
  logCode: string | undefined,
): { name: string; message: string; stack?: string } {
  const stack = exception.stack && redactSecretsInText(exception.stack);
  if (!logCode) {
    return {
      name: exception.name,
      message: redactSecretsInText(exception.message),
      stack,
    };
  }
  return {
    name: exception.name,
    message: logCode,
    stack: stack?.split("\n").slice(1).join("\n"),
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // One-shot tokens in the path (Wallet pass link) never reach logs.
    const safeUrl = redactUrl(request.url);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Nest's own 404 ("Cannot GET /…") echoes the path: redact it too.
    const message = redactSecretsDeep(
      exception instanceof HttpException
        ? typeof exception.getResponse() === "string"
          ? exception.getResponse()
          : ((exception.getResponse() as { message?: string }).message ??
            exception.message)
        : exception instanceof Error
          ? exception.message
          : "Internal server error",
    );

    // Admin 409s carry details the back-office needs: the clashing club
    // (create / rename), what still points at a club (delete), the existing
    // track of a duplicate import, or the corrections that block a track
    // deletion. Whitelisted
    // keys and primitive values only.
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const conflictDetails: Record<string, string | number> = {};
    if (
      status === HTTP_STATUS_CONFLICT &&
      typeof body === "object" &&
      body !== null
    ) {
      for (const key of CONFLICT_DETAIL_KEYS) {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value === "string" || typeof value === "number") {
          conflictDetails[key] = value;
        }
      }
    }

    // Stable error code (#225), answered to the client. When a code is set,
    // the logs see `logCode` in place of the message: some messages carry
    // health data (medical unfitness), and for those the fine code itself is
    // replaced by a neutral one.
    const code = errorCodeOf(body);
    const logCode = logCodeOf(exception, body);

    // Logging structuré pour le debugging
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safeUrl,
      method: request.method,
      message,
      ...(code ? { code } : {}),
      ...conflictDetails,
    };

    // Log les erreurs selon leur sévérité avec logging structuré
    if (status >= 500) {
      // 503 = service temporairement indisponible : une dépendance externe est
      // down, ou une intégration optionnelle (ex. WDSF) n'est pas configurée.
      // C'est un état opérationnel, pas un défaut de code → on le logge mais on
      // ne l'envoie PAS à Sentry (sinon bruit permanent). Tout autre 5xx est une
      // vraie erreur serveur et part dans Sentry.
      if (status !== HTTP_STATUS_SERVICE_UNAVAILABLE) {
        Sentry.captureException(
          logCode
            ? new Error(logCode)
            : exception instanceof Error
              ? exception
              : new Error(String(exception)),
        );
      }

      const logMessage =
        logCode ??
        (typeof message === "string" ? message : JSON.stringify(message));

      this.logger.error(
        {
          method: request.method,
          url: safeUrl,
          statusCode: status,
          message: logMessage,
          error:
            exception instanceof Error
              ? describeError(exception, logCode)
              : redactSecretsDeep(exception),
          context: "HttpExceptionFilter",
        },
        `${request.method} ${safeUrl} - ${logMessage}`,
      );
    } else if (status >= 400) {
      const logMessage =
        logCode ??
        (typeof message === "string" ? message : JSON.stringify(message));

      this.logger.warn(
        {
          method: request.method,
          url: safeUrl,
          statusCode: status,
          message: logMessage,
          context: "HttpExceptionFilter",
        },
        `${request.method} ${safeUrl} - ${logMessage}`,
      );
    }

    // Retourner la réponse standardisée
    response.status(status).json(errorResponse);
  }
}
