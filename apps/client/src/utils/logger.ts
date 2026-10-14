/**
 * Logger structuré pour React Native
 *
 * Fournit un système de logging avec niveaux (debug, info, warn, error)
 * qui peut être désactivé en production.
 */
import * as Sentry from "@sentry/react-native";
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

class Logger {
  private minLevel: LogLevel;
  private enabled: boolean;
  private logs: LogEntry[] = [];
  private maxLogs = 100; // Limite pour éviter la surcharge mémoire

  constructor(context?: string) {
    this.context = context ?? "App";
    // En production, désactiver les logs de debug/info
    this.enabled = __DEV__ || process.env.NODE_ENV !== "production";
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
    this.log(
      LogLevel.WARN,
      message,
      data,
      error instanceof Error ? error : undefined,
    );
  }

  /**
   * Log d'erreur
   */
  error(message: string, error?: unknown, data?: unknown): void {
    this.log(
      LogLevel.ERROR,
      message,
      data,
      error instanceof Error ? error : undefined,
    );
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

    // Afficher dans la console selon le niveau
    const formattedMessage = entry.message;
    const logData = data ? [formattedMessage, data] : [formattedMessage];

    switch (level) {
      case LogLevel.DEBUG:
        if (__DEV__) {
          console.warn(...logData);
        }
        break;
      case LogLevel.INFO:
        console.warn(...logData);
        break;
      case LogLevel.WARN:
        console.warn(...logData, error ?? "");
        break;
      case LogLevel.ERROR: {
        const http = getHttpErrorInfo(error);
        // Expected 4xx (401 handled by the refresh, 403, 404, 429...) are
        // outcomes, not bugs (#585): a warning breadcrumb gives context to a
        // later real error without creating a Sentry issue of its own.
        if (http && isExpectedHttpStatus(http.status)) {
          console.warn(...logData, error ?? "");
          try {
            Sentry.addBreadcrumb({
              category: "http",
              level: "warning",
              message: formattedMessage,
              data: {
                status: http.status,
                method: http.method,
                route: http.route,
              },
            });
          } catch {
            /* ignore */
          }
          break;
        }
        console.error(...logData, error ?? "");
        if (error?.stack) {
          const isHttpError =
            error instanceof Error &&
            (error.message.includes("status code") ||
              error.message.includes("HTTP") ||
              error.name === "HttpError" ||
              error.name === "AxiosError");

          if (!isHttpError || __DEV__) {
            console.error("Stack:", error.stack);
          }
        }
        try {
          if (error) {
            Sentry.captureException(error, {
              extra: { message, context: this.context, data },
              // One Sentry issue per status + route instead of a single
              // bucket for every AxiosError (same minified `settle` stack).
              ...(http
                ? {
                    fingerprint: httpFingerprint(http),
                    tags: {
                      http_status:
                        http.status === undefined
                          ? "network"
                          : String(http.status),
                      http_route: http.route,
                    },
                  }
                : {}),
            });
          } else {
            Sentry.captureMessage(formattedMessage, "error");
          }
        } catch {
          /* ignore */
        }
        break;
      }
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
