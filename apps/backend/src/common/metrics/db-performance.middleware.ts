import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "./metrics.service";

/**
 * Middleware pour analyser les performances des requêtes Prisma
 *
 * Enregistre les métriques de performance pour chaque requête Prisma
 * et détecte les requêtes lentes ou les N+1 queries potentielles
 */
@Injectable()
export class DbPerformanceMiddleware implements NestMiddleware {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    this.setupPrismaQueryLogging();
  }

  use(_req: Request, _res: Response, next: NextFunction) {
    next();
  }

  /**
   * Configure le logging des requêtes Prisma
   */
  private setupPrismaQueryLogging() {
    // Intercepter les requêtes Prisma pour mesurer leur durée
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalQuery = this.prisma.$queryRaw;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalExecute = this.prisma.$executeRaw;

    // Wrapper pour $queryRaw
    // @ts-expect-error: Overriding Prisma method for logging
    this.prisma.$queryRaw = async (...args: unknown[]) => {
      const start = Date.now();
      try {
        const result = await (
          originalQuery as {
            apply: (thisArg: unknown, args: unknown[]) => Promise<unknown>;
          }
        ).apply(this.prisma, args);
        const duration = Date.now() - start;
        this.recordQuery("$queryRaw", duration, args[0]);
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.recordQuery("$queryRaw", duration, args[0], error);
        throw error;
      }
    };

    // Wrapper pour $executeRaw
    // @ts-expect-error: Overriding Prisma method for logging
    this.prisma.$executeRaw = async (...args: unknown[]) => {
      const start = Date.now();
      try {
        const result = await (
          originalExecute as {
            apply: (thisArg: unknown, args: unknown[]) => Promise<unknown>;
          }
        ).apply(this.prisma, args);
        const duration = Date.now() - start;
        this.recordQuery("$executeRaw", duration, args[0]);
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.recordQuery("$executeRaw", duration, args[0], error);
        throw error;
      }
    };
  }

  /**
   * Enregistre une métrique de requête DB
   */
  private recordQuery(
    queryType: string,
    duration: number,
    query: unknown,
    _error?: unknown,
  ): void {
    const queryString =
      typeof query === "string"
        ? query.substring(0, 200)
        : JSON.stringify(query).substring(0, 200);

    this.metricsService.recordDatabaseMetric({
      query: `${queryType}: ${queryString}`,
      duration,
      timestamp: new Date(),
    });
  }
}
