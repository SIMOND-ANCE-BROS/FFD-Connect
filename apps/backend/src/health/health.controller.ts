import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { HealthService } from "./health.service";

interface HealthStatus {
  status: "ok" | "degraded" | "down";
  version: string;
  timestamp: string;
  uptime: number;
  database: {
    status: "ok" | "error";
    responseTime?: number;
    error?: string;
  };
  redis: {
    status: "ok" | "error";
    responseTime?: number;
    error?: string;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
}

interface Metrics {
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

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  @ApiOperation({ summary: "Liveness probe (process up)" })
  @ApiResponse({ status: 200, description: "Process is running" })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get()
  @ApiOperation({ summary: "Health check endpoint (DB + Redis)" })
  @ApiResponse({
    status: 200,
    description: "Service is healthy or degraded (still serving)",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        timestamp: { type: "string", example: "2026-02-11T12:00:00.000Z" },
        uptime: { type: "number", example: 3600 },
        database: { type: "object" },
        redis: { type: "object" },
        memory: { type: "object" },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "Service is down (DB and Redis both unreachable)",
  })
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    const result = await this.healthService.check();
    // Return 503 only on a hard outage (status "down" = both DB and Redis
    // unreachable) so external uptime probes alert. "degraded" stays 200 —
    // the app is still serving, no need to page.
    if (result.status === "down") {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Get("metrics")
  @ApiOperation({ summary: "Get application metrics" })
  @ApiResponse({
    status: 200,
    description: "Application metrics",
    schema: {
      type: "object",
      properties: {
        uptime: { type: "number" },
        memory: { type: "object" },
        cpu: { type: "object" },
        requests: { type: "object" },
      },
    },
  })
  metrics(): Metrics {
    return this.healthService.getMetrics();
  }
}
