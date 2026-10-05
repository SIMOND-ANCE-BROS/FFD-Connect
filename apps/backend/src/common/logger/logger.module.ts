import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { IncomingMessage, ServerResponse } from "http";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { LoggerService } from "./logger.service";

/**
 * Module de logging structuré avec Pino
 *
 * Fournit un système de logging performant et structuré pour l'application.
 * Les logs sont formatés en JSON en production et de manière lisible en développement.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDevelopment = configService.get("NODE_ENV") !== "production";

        return {
          pinoHttp: {
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
                url: req.url ?? "",
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
              return `${req.method ?? ""} ${req.url ?? ""} ${res.statusCode}`;
            },
            customErrorMessage: (
              req: IncomingMessage,
              res: ServerResponse,
              err: Error,
            ) => {
              return `${req.method ?? ""} ${req.url ?? ""} ${res.statusCode} - ${err.message}`;
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
          },
        };
      },
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService, PinoLoggerModule],
})
export class LoggerModule {}
