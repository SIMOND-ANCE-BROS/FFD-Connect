import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { LoggerService } from "./logger.service";
import { buildPinoHttpOptions } from "./pino-http.options";

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
          pinoHttp: buildPinoHttpOptions(isDevelopment),
        };
      },
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService, PinoLoggerModule],
})
export class LoggerModule {}
