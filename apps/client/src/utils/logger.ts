/**
 * Logger structuré pour React Native
 *
 * Fournit un système de logging avec niveaux (debug, info, warn, error).
 *
 * Release builds (#589): the logger stays on with a WARN floor (debug/info
 * off). `warn` leaves a Sentry breadcrumb (context for a later event, never an
 * event itself); `error` captures to Sentry, except expected HTTP 4xx (a
 * breadcrumb, #585) and an unreadable token store (nothing, #582). What goes
 * to Sentry is scrubbed of personal data first (`logScrub`). The console is
 * only written in development: in release the Sentry console integration
 * would turn it into unscrubbed breadcrumbs.
 */
import * as Sentry from "@sentry/react-native";
import { isTokenStoreUnavailable } from "../api/tokenStoreErrors";
import { scrubLogData, scrubText } from "./logScrub";
import {
  getHttpErrorInfo,
  httpFingerprint,
  isExpectedHttpStatus,
} from "./httpErrorInfo";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  error?: Error;
  data?: unknown;
}

/**
 * Callers often pass a non-Error as the `error` argument (a thrown string, a
 * native event, a `{ url, status }` bag): keep it as `data` rather than
 * dropping it, unless explicit `data` was given too.
 */
function splitError(
  error: unknown,
  data: unknown,
): [data: unknown, error: Error | undefined] {
  if (error instanceof Error) return [data, error];
  if (error === undefined || data !== undefined) return [data, undefined];
  return [error, undefined];
}

class Logger {
  private minLevel: LogLevel;
  private enabled: boolean;
  private logs: LogEntry[] = [];
  private maxLogs = 100; // Limite pour éviter la surcharge mémoire

  constructor(context?: string) {
    this.context = context ?? "App";
    // On in every build (#589): release keeps warn/error only, so
    // `logger.error` reaches Sentry from beta and production.
    this.enabled = true;
    this.minLevel = __DEV__ ? LogLevel.DEBUG : LogLevel.WARN;
  }

  private context: string;

  /**
   * Configure le niveau minimum de log
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Active ou désactive le logger
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Log de debug (développement uniquement)
   */
  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log d'information
   */
  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log d'avertissement
   */
  warn(message: string, error?: unknown, data?: unknown): void {
    this.log(LogLevel.WARN, message, ...splitError(error, data));
  }

  /**
   * Log d'erreur
   */
  error(message: string, error?: unknown, data?: unknown): void {
    this.log(LogLevel.ERROR, message, ...splitError(error, data));
  }

  /**
   * Méthode interne de logging
   */
  private log(
    level: LogLevel,
    message: string,
    data?: unknown,
    error?: Error,
  ): void {
    if (!this.enabled || level < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      level,
      message: `[${this.context}] ${message}`,
      timestamp: new Date().toISOString(),
      context: this.context,
      data,
      error,
    };

    // Stocker les logs (limité pour éviter la surcharge)
    if (this.logs.length >= this.maxLogs) {
      this.logs.shift();
    }
    this.logs.push(entry);

    const formattedMessage = entry.message;
    // Console in development only (see header): in release, console calls
    // become Sentry breadcrumbs carrying the raw, unscrubbed data.
    const consoleOn = __DEV__;
    const logData = data ? [formattedMessage, data] : [formattedMessage];

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        if (consoleOn) console.warn(...logData);
        break;
      case LogLevel.WARN:
        if (consoleOn) console.warn(...logData, error ?? "");
        this.breadcrumb("logger", formattedMessage, error, data);
        break;
      case LogLevel.ERROR:
        this.reportError(formattedMessage, message, logData, error, data);
        break;
    }
  }

  /** Warning breadcrumb: context for a later event, never an event itself. */
  private breadcrumb(
    category: string,
    formattedMessage: string,
    error: Error | undefined,
    data: unknown,
  ): void {
    try {
      Sentry.addBreadcrumb({
        category,
        level: "warning",
        message: scrubText(formattedMessage),
        data: {
          context: this.context,
          ...(error ? { error: scrubLogData(error) } : {}),
          ...(data === undefined ? {} : { data: scrubLogData(data) }),
        },
      });
    } catch {
      /* ignore */
    }
  }

  private reportError(
    formattedMessage: string,
    message: string,
    logData: unknown[],
    error: Error | undefined,
    data: unknown,
  ): void {
    const consoleOn = __DEV__;
    // Unreadable token store (#582): never an error event. A locked
    // iPhone is expected; a persistent failure is reported once by
    // tokenStore itself (which also leaves the breadcrumbs).
    if (isTokenStoreUnavailable(error)) {
      if (consoleOn) console.warn(...logData, error);
      return;
    }
    const http = getHttpErrorInfo(error);
    // Expected 4xx (401 handled by the refresh, 403, 404, 429...) are
    // outcomes, not bugs (#585): a warning breadcrumb gives context to a
    // later real error without creating a Sentry issue of its own.
    if (http && isExpectedHttpStatus(http.status)) {
      if (consoleOn) console.warn(...logData, error ?? "");
      try {
        Sentry.addBreadcrumb({
          category: "http",
          level: "warning",
          message: scrubText(formattedMessage),
          data: {
            status: http.status,
            method: http.method,
            route: http.route,
          },
        });
      } catch {
        /* ignore */
      }
      return;
    }
    if (consoleOn) {
      console.error(...logData, error ?? "");
      if (error?.stack) console.error("Stack:", error.stack);
    }
    try {
      if (error) {
        Sentry.captureException(error, {
          extra: {
            message: scrubText(message),
            context: this.context,
            data: scrubLogData(data),
          },
          // One Sentry issue per status + route instead of a single
          // bucket for every AxiosError (same minified `settle` stack).
          ...(http
            ? {
                fingerprint: httpFingerprint(http),
                tags: {
                  http_status:
                    http.status === undefined ? "network" : String(http.status),
                  http_route: http.route,
                },
              }
            : {}),
        });
      } else {
        Sentry.captureMessage(scrubText(formattedMessage), {
          level: "error",
          extra: { context: this.context, data: scrubLogData(data) },
        });
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Récupère les logs stockés
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Vide les logs stockés
   */
  clearLogs(): void {
    this.logs = [];
  }
}

// Instance par défaut
const defaultLogger = new Logger();

/**
 * Crée un logger avec un contexte spécifique
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

/**
 * Logger par défaut pour l'application
 */
export const logger = defaultLogger;

// Export du Logger pour utilisation directe si besoin
export { Logger };
