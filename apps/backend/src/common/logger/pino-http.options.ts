import type { IncomingMessage, ServerResponse } from "http";
import type { Options } from "pino-http";
import { anonymizeIp } from "./anonymize-ip";
import { redactSecretsInText, redactUrl } from "./redact-url";

/**
 * Log keys holding a client IP, wherever a caller puts them: the request
 * interceptor logs `ip` (`req.ip`). Truncated by {@link anonymizeIp} through
 * pino's `redact`, so no call site can write a full address (RGPD, #529).
 * The access log's own `req.remoteAddress` is truncated in its serializer.
 */
export const IP_LOG_PATHS = ["ip", "clientIp", "remoteAddress", "*.ip"];

/**
 * pino-http options (access log). Extracted from LoggerModule so the
 * serializers and messages — which must never contain a one-shot token
 * carried in the URL (Wallet pass link, #162) — are unit-tested.
 */
export function buildPinoHttpOptions(isDevelopment: boolean): Options {
  return {
    level: isDevelopment ? "debug" : "info",
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
            singleLine: false,
          },
        }
      : undefined,
    redact: {
      paths: IP_LOG_PATHS,
      censor: (value: unknown) => anonymizeIp(value),
    },
    serializers: {
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method ?? "",
        url: redactUrl(req.url),
        headers: {
          host: req.headers.host,
          "user-agent": req.headers["user-agent"],
        },
        // Network prefix only, and no source port (RGPD, #529).
        remoteAddress: anonymizeIp(req.socket?.remoteAddress),
      }),
      res: (res: ServerResponse) => ({
        statusCode: res.statusCode,
      }),
      err: (err: Error) => ({
        type: err.constructor.name,
        message: redactSecretsInText(err.message),
        stack: err.stack && redactSecretsInText(err.stack),
      }),
    },
    customProps: (_req: IncomingMessage, _res: ServerResponse) => ({
      context: "HTTP",
    }),
    customSuccessMessage: (
      req: IncomingMessage,
      res: ServerResponse,
      _responseTime: number,
    ) => {
      return `${req.method ?? ""} ${redactUrl(req.url)} ${res.statusCode}`;
    },
    customErrorMessage: (
      req: IncomingMessage,
      res: ServerResponse,
      err: Error,
    ) => {
      return `${req.method ?? ""} ${redactUrl(req.url)} ${res.statusCode} - ${redactSecretsInText(err.message)}`;
    },
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      err?: Error,
    ) => {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return "warn";
      } else if (res.statusCode >= 500 || err) {
        return "error";
      }
      return "info";
    },
  };
}
