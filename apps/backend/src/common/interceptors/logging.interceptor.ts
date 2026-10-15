import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";
import { redactSecretsInText, redactUrl } from "../logger/redact-url";
import { logCodeOf } from "../errors/coded-bad-request.exception";

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
    const { method, ip, headers } = request;
    // Never log one-shot tokens carried in the path (Wallet pass link).
    const url = redactUrl(request.url);
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
          // This runs before the global exception filter writes the response,
          // so `response.statusCode` is still the default 200 here (#571):
          // the status comes from the exception itself.
          const delay = Date.now() - now;
          const statusCode =
            error instanceof HttpException
              ? error.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR;
          const err = error instanceof Error ? error : new Error(String(error));
          // A coded error (#225) only ever shows its code in the logs.
          const logCode = logCodeOf(
            error,
            error instanceof HttpException ? error.getResponse() : null,
          );
          const message = logCode ?? redactSecretsInText(err.message);
          const logData = {
            method,
            url,
            statusCode,
            duration: delay,
            ip,
            context: "HTTP_ERROR",
          };
          const text = `${method} ${url} ${statusCode} - ${delay}ms - ${message}`;

          if (statusCode < 500) {
            // An expected client error: no stack, warn level.
            this.logger.warn(
              { ...logData, error: { name: err.name, message } },
              text,
            );
            return;
          }

          // With a log code, the stack header ("Name: message") is dropped
          // like in HttpExceptionFilter so the original text never leaks.
          const stack = err.stack && redactSecretsInText(err.stack);
          this.logger.error(
            {
              ...logData,
              error: {
                name: err.name,
                message,
                stack: logCode ? stack?.split("\n").slice(1).join("\n") : stack,
              },
            },
            text,
          );
        },
      }),
    );
  }
}
