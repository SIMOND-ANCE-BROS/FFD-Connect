import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

/**
 * Service de logging structuré
 *
 * Wrapper autour de PinoLogger pour faciliter l'utilisation dans les services.
 * Fournit des méthodes de logging structurées avec contexte.
 */
@Injectable()
export class LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * Log un message de niveau debug
   */
  debug(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.logger.debug({ context, ...meta }, message);
  }

  /**
   * Log un message de niveau info
   */
  info(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.logger.info({ context, ...meta }, message);
  }

  /**
   * Log un message de niveau warn
   */
  warn(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.logger.warn({ context, ...meta }, message);
  }

  /**
   * Log un message de niveau error
   */
  error(
    message: string,
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    error?: Error | unknown,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    const errorMeta =
      error instanceof Error
        ? {
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
          }
        : { error };
    this.logger.error({ context, ...errorMeta, ...meta }, message);
  }

  /**
   * Log une requête HTTP
   */
  logHttpRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    meta?: Record<string, unknown>,
  ): void {
    const level =
      statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    this.logger[level](
      {
        method,
        url,
        statusCode,
        duration,
        context: "HTTP",
        ...meta,
      },
      `${method} ${url} ${statusCode} - ${duration}ms`,
    );
  }
}
