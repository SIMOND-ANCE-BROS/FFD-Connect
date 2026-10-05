import {
  Controller,
  Get,
  HttpStatus,
  RequestMethod,
  Res,
} from "@nestjs/common";
import type { RouteInfo } from "@nestjs/common/interfaces";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { HealthService } from "./health.service";
import type { HealthStatus, Metrics } from "./health.types";

/**
 * Health routes are served at the root, outside the `api/v1` global prefix:
 * monitoring must not have to track the API version. They must be excluded
 * from the prefix wherever it is set (main.ts, test app factory).
 *
 * This is an explicit list, not a wildcard: there are three routes, they are
 * stable, and the former `health/(.*)` used the pre-v8 `path-to-regexp` syntax
 * that NestJS only still accepts through a compatibility converter — one
 * `LegacyRouteConverter` warning per boot, and the converter is going away
 * (#43). `health.routes.spec.ts` fails if a route is added to this controller
 * without being excluded here.
 */
export const HEALTH_PREFIX_EXCLUDE: RouteInfo[] = [
  { path: "health", method: RequestMethod.GET },
  { path: "health/live", method: RequestMethod.GET },
  { path: "health/metrics", method: RequestMethod.GET },
];

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
        // Read by the deployment smoke test, which compares it to the SHA it
        // just deployed and rolls back on a mismatch.
        version: { type: "string", example: "a1b2c3d" },
        timestamp: { type: "string", example: "2026-02-11T12:00:00.000Z" },
        uptime: { type: "number", example: 3600 },
        database: { type: "object" },
        redis: { type: "object" },
        queues: { type: "object" },
        memory: {
          type: "object",
          description:
            "Chaque champ est nommé d'après ce à quoi il est rapporté. " +
            "Le seul indicateur de saturation est rssPercentOfLimit ; le " +
            "ratio du tas V8 est élevé en fonctionnement normal.",
          properties: {
            rss: {
              type: "number",
              description: "Resident set size du process, en octets",
              example: 82837504,
            },
            limit: {
              type: "number",
              description:
                "Plafond auquel rss est rapporté, en octets (limite du " +
                "conteneur, ou RAM de l'hôte à défaut)",
              example: 1073741824,
            },
            limitSource: {
              type: "string",
              enum: ["cgroup", "os"],
              description:
                "cgroup = limite réelle du conteneur ; os = aucune limite " +
                "trouvée, RAM de l'hôte utilisée",
              example: "cgroup",
            },
            rssPercentOfLimit: {
              type: "number",
              description: "rss / limit, en pourcentage",
              example: 7.7,
            },
            heapUsed: { type: "number", example: 78993784 },
            heapTotal: { type: "number", example: 84381696 },
            heapUsedPercentOfHeapTotal: {
              type: "number",
              description:
                "Taux de remplissage du tas V8 — détail de debug, PAS une " +
                "pression mémoire",
              example: 93.6,
            },
          },
        },
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
