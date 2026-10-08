import type { IncomingMessage, ServerResponse } from "http";
import type { Options } from "pino-http";
import { redactUrl } from "./redact-url";

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
    serializers: {
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method ?? "",
        url: redactUrl(req.url),
        headers: {
          host: req.headers.host,
          "user-agent": req.headers["user-agent"],
        },
        remoteAddress: req.socket?.remoteAddress,
        remotePort: req.socket?.remotePort,
      }),
      res: (res: ServerResponse) => ({
        statusCode: res.statusCode,
      }),
      err: (err: Error) => ({
        type: err.constructor.name,
        message: err.message,
        stack: err.stack,
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
      return `${req.method ?? ""} ${redactUrl(req.url)} ${res.statusCode} - ${err.message}`;
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
