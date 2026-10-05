import type { MemoryLimitSource } from "./container-memory.util";

export interface QueueHealth {
  status: "ok" | "degraded" | "error";
  waiting: number;
  active: number;
  failed: number;
  error?: string;
}

export interface DependencyHealth {
  status: "ok" | "error";
  responseTime?: number;
  error?: string;
}

/**
 * Memory as reported by `GET /health`.
 *
 * Every field is named after what it is measured against, because the previous
 * shape (`used`/`total`/`percentage`) was the V8 heap fill ratio read as
 * container saturation: it showed 94 % on a healthy backend sized at 1 Gi and
 * misled a deployment check (#44).
 */
export interface MemoryHealth {
  /** Resident set size of the Node process, in bytes. */
  rss: number;
  /** The ceiling `rss` is judged against, in bytes. */
  limit: number;
  /** Where `limit` comes from: "cgroup" (container) or "os" (host RAM). */
  limitSource: MemoryLimitSource;
  /**
   * `rss / limit` as a percentage. THIS is the saturation signal — the only
   * memory number worth alerting on.
   */
  rssPercentOfLimit: number;
  /** V8 heap in use, in bytes. */
  heapUsed: number;
  /** Current V8 heap size, in bytes — grown on demand, not a ceiling. */
  heapTotal: number;
  /**
   * `heapUsed / heapTotal` as a percentage. Process-level detail, NOT memory
   * pressure: V8 keeps `heapTotal` trimmed to what it uses, so a high ratio is
   * normal operation.
   */
  heapUsedPercentOfHeapTotal: number;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  version: string;
  timestamp: string;
  uptime: number;
  database: DependencyHealth;
  redis: DependencyHealth;
  queues: Record<string, QueueHealth>;
  memory: MemoryHealth;
}

export interface Metrics {
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
  };
  requests: {
    total: number;
    errors: number;
  };
}
