import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { MetricsService } from "./metrics.service";

/**
 * Intercepteur de métriques pour enregistrer les performances HTTP
 *
 * Enregistre automatiquement les métriques de performance pour chaque requête HTTP
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - now;
          const statusCode = response.statusCode;

          // Enregistrer la métrique
          this.metricsService.recordHttpMetric({
            endpoint: url,
            method,
            duration,
            statusCode,
            timestamp: new Date(),
          });
        },
        error: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - now;
          const statusCode = response.statusCode || 500;

          // Enregistrer la métrique d'erreur
          this.metricsService.recordHttpMetric({
            endpoint: url,
            method,
            duration,
            statusCode,
            timestamp: new Date(),
          });
        },
      }),
    );
  }
}
