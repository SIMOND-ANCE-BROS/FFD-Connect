import { Injectable, OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

export interface PerformanceMetrics {
  endpoint: string;
  method: string;
  duration: number;
  statusCode: number;
  timestamp: Date;
}

export interface DatabaseMetrics {
  query: string;
  duration: number;
  timestamp: Date;
}

@Injectable()
export class MetricsService implements OnModuleInit {
  constructor(private readonly logger: PinoLogger) {}

  onModuleInit() {
    setInterval(() => {
      this.logSystemMetrics();
    }, 60000);
  }

  recordHttpMetric(metric: PerformanceMetrics): void {
    if (metric.duration > 1000) {
      this.logger.warn(
        {
          metric: "slow_request",
          endpoint: metric.endpoint,
          method: metric.method,
          duration: metric.duration,
          statusCode: metric.statusCode,
          context: "MetricsService",
        },
        `Slow request detected: ${metric.method} ${metric.endpoint} took ${metric.duration}ms`,
      );
    }
  }

  recordDatabaseMetric(metric: DatabaseMetrics): void {
    if (metric.duration > 500) {
      this.logger.warn(
        {
          metric: "slow_query",
          query: metric.query.substring(0, 200),
          duration: metric.duration,
          context: "MetricsService",
        },
        `Slow database query detected: ${metric.duration}ms`,
      );
    }
  }

  private logSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();

    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
    const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

    if (heapUsagePercent > 80) {
      this.logger.warn(
        {
          metric: "high_memory_usage",
          heapUsedMB,
          heapTotalMB,
          heapUsagePercent: heapUsagePercent.toFixed(2),
          context: "MetricsService",
        },
        `High memory usage detected: ${heapUsagePercent.toFixed(2)}%`,
      );
    }

    this.logger.debug(
      {
        metric: "system_metrics",
        memory: {
          heapUsed: `${heapUsedMB.toFixed(2)}MB`,
          heapTotal: `${heapTotalMB.toFixed(2)}MB`,
          external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)}MB`,
          rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`,
        },
        context: "MetricsService",
      },
      "System metrics",
    );
  }
}
