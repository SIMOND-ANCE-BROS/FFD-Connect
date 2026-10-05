import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";

/**
 * Intercepteur de logging structuré pour tracer les requêtes HTTP
 *
 * Log les requêtes entrantes et les réponses avec les temps d'exécution
 * Utilise Pino pour un logging structuré et performant
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip, headers } = request;
    // Security: never log Authorization, Cookie, or other sensitive headers; do not attach request body or headers to error logs.
    const userAgent = headers["user-agent"] ?? "unknown";
    const now = Date.now();

    // Log de la requête entrante
    this.logger.debug(
      {
        method,
        url,
        ip,
        userAgent,
        context: "HTTP_REQUEST",
      },
      `Incoming request: ${method} ${url}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const delay = Date.now() - now;
          const statusCode = response.statusCode;

          // Log structuré de la réponse
          const logData = {
            method,
            url,
            statusCode,
            duration: delay,
            ip,
            context: "HTTP_RESPONSE",
          };

          if (statusCode >= 400 && statusCode < 500) {
            this.logger.warn(
              logData,
              `${method} ${url} ${statusCode} - ${delay}ms`,
            );
          } else if (statusCode >= 500) {
            this.logger.error(
              logData,
              `${method} ${url} ${statusCode} - ${delay}ms`,
            );
          } else {
            this.logger.info(
              logData,
              `${method} ${url} ${statusCode} - ${delay}ms`,
            );
          }
        },
        error: (error: unknown) => {
          const response = context.switchToHttp().getResponse<Response>();
          const delay = Date.now() - now;
          const statusCode = response.statusCode || 500;
          const err = error instanceof Error ? error : new Error(String(error));

          // Log structuré de l'erreur
          this.logger.error(
            {
              method,
              url,
              statusCode,
              duration: delay,
              ip,
              error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
              },
              context: "HTTP_ERROR",
            },
            `${method} ${url} ${statusCode} - ${delay}ms - ${err.message}`,
          );
        },
      }),
    );
  }
}
