import { ConfigService } from "@nestjs/config";
import type { RedisOptions } from "bullmq";

/**
 * Connection options for `BullModule.forRootAsync`. BullMQ builds its own
 * ioredis clients from these plain options, so whatever is set (or not set)
 * here is what the queue speaks on the wire. Shared with the integration
 * test so it exercises the exact production configuration.
 *
 * No `protocol` is set on purpose: ioredis 6 then negotiates RESP3
 * (`HELLO 3`). Both `ffd-redis-*` Container Apps run `redis:7-alpine`
 * (checked 2026-10-17, see docs/exploitation/deploiement-azure.md), and the
 * queue is proven under RESP3 and RESP2 by
 * test/bullmq-queue.integration-spec.ts (#36). Should a Redis older than 6
 * ever be used again, `protocol: 2` here and in RedisService restores the
 * RESP2 wire format.
 */
export function buildBullConnection(configService: ConfigService): {
  connection: RedisOptions;
} {
  return {
    connection: {
      host: configService.get<string>("REDIS_HOST", "localhost"),
      port: configService.get<number>("REDIS_PORT", 6379),
      password: configService.get<string>("REDIS_PASSWORD"),
    },
  };
}
