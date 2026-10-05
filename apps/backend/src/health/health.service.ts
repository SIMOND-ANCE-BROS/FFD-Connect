import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  type MemoryLimit,
  resolveMemoryLimit,
  toPercent,
} from "./container-memory.util";
import type {
  DependencyHealth,
  HealthStatus,
  MemoryHealth,
  Metrics,
  QueueHealth,
} from "./health.types";

// Seuil pour détecter une queue en mauvaise santé.
// Le nombre de jobs `failed` n'est PAS un signal d'infra : c'est cumulatif
// (BullMQ garde les derniers échecs) et surtout piloté par l'utilisateur. Seul
// un backlog `waiting` anormal indique un worker bloqué. Les échecs restent
// exposés dans le payload pour visibilité.
const QUEUE_WAITING_THRESHOLD = 100; // > 100 jobs en attente = backlog anormal

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  /**
   * Resolved once: a container's cgroup limit cannot change while it runs, and
   * `/health` must not do a filesystem read per probe.
   */
  private memoryLimit?: MemoryLimit;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    @InjectQueue("ffd-sync") private readonly syncQueue: Queue,
  ) {}

  async check(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const [dbCheck, redisCheck, queuesCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueues(),
    ]);

    const memory = this.getMemoryHealth();

    const queuesDegraded = Object.values(queuesCheck).some(
      (q) => q.status !== "ok",
    );

    let status: "ok" | "degraded" | "down" = "ok";
    if (
      dbCheck.status === "error" ||
      redisCheck.status === "error" ||
      queuesDegraded
    ) {
      status = "degraded";
    }
    if (dbCheck.status === "error" && redisCheck.status === "error") {
      status = "down";
    }

    return {
      status,
      version: this.configService.get<string>("APP_VERSION") ?? "unknown",
      timestamp,
      uptime,
      database: dbCheck,
      redis: redisCheck,
      queues: queuesCheck,
      memory,
    };
  }

  /**
   * Memory as `/health` publishes it.
   *
   * The headline figure is `rss` against the container's memory limit, because
   * that is what the platform kills the process over. The V8 heap ratio is kept
   * alongside it — it is useful when debugging a leak — but under a name that
   * says what it divides by, so it can no longer be read as saturation (#44).
   */
  private getMemoryHealth(): MemoryHealth {
    this.memoryLimit ??= resolveMemoryLimit();
    const usage = process.memoryUsage();

    return {
      rss: usage.rss,
      limit: this.memoryLimit.bytes,
      limitSource: this.memoryLimit.source,
      rssPercentOfLimit: toPercent(usage.rss, this.memoryLimit.bytes),
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      heapUsedPercentOfHeapTotal: toPercent(usage.heapUsed, usage.heapTotal),
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Database connection failed";
      this.logger.error("Database health check failed", error);
      return { status: "error", error: errorMessage };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const startTime = Date.now();
    try {
      if (!this.redis.isAvailable()) {
        return { status: "error", error: "Redis not available" };
      }
      const client = this.redis.getClient();
      if (!client) {
        return { status: "error", error: "Redis client not initialized" };
      }
      await client.ping();
      return { status: "ok", responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Redis connection failed";
      this.logger.warn("Redis health check failed", error);
      return { status: "error", error: errorMessage };
    }
  }

  private async checkQueues(): Promise<Record<string, QueueHealth>> {
    const queues: Record<string, Queue> = {
      "ffd-sync": this.syncQueue,
    };

    const entries = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "failed",
            "delayed",
            "completed",
          );
          const { waiting, active, failed } = counts;

          let queueStatus: "ok" | "degraded" = "ok";
          if (waiting > QUEUE_WAITING_THRESHOLD) {
            queueStatus = "degraded";
          }

          return [
            name,
            { status: queueStatus, waiting, active, failed },
          ] as const;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Queue check failed";
          this.logger.warn(`Queue ${name} health check failed`, error);
          return [
            name,
            {
              status: "error" as const,
              waiting: 0,
              active: 0,
              failed: 0,
              error: errorMessage,
            },
          ] as const;
        }
      }),
    );

    return Object.fromEntries(entries) as Record<string, QueueHealth>;
  }

  getMetrics(): Metrics {
    const memoryUsage = process.memoryUsage();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      uptime,
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpu: {
        usage: process.cpuUsage().user / 1000000,
      },
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
      },
    };
  }

  incrementRequestCount(): void {
    this.requestCount++;
  }

  incrementErrorCount(): void {
    this.errorCount++;
  }
}
