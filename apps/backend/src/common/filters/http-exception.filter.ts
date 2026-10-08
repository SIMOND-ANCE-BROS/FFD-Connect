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
] as const;

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
    // (create / rename) or what still points at a club (delete). Whitelisted
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

    // Logging structuré pour le debugging
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safeUrl,
      method: request.method,
      message,
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
          exception instanceof Error ? exception : new Error(String(exception)),
        );
      }

      const logMessage =
        typeof message === "string" ? message : JSON.stringify(message);

      this.logger.error(
        {
          method: request.method,
          url: safeUrl,
          statusCode: status,
          message: logMessage,
          error:
            exception instanceof Error
              ? {
                  name: exception.name,
                  message: redactSecretsInText(exception.message),
                  stack:
                    exception.stack && redactSecretsInText(exception.stack),
                }
              : redactSecretsDeep(exception),
          context: "HttpExceptionFilter",
        },
        `${request.method} ${safeUrl} - ${logMessage}`,
      );
    } else if (status >= 400) {
      const logMessage =
        typeof message === "string" ? message : JSON.stringify(message);

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
