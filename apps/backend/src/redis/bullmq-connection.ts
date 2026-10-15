import { ConfigService } from "@nestjs/config";
import type { RedisOptions } from "bullmq";

/**
 * Redis wire protocol used by every ioredis client the backend opens
 * (RedisService and the BullMQ connection).
 *
 * ioredis 6 defaults to RESP3. BullMQ 6 is validated against a real Redis
 * under both RESP2 and RESP3 (test/bullmq-queue.integration-spec.ts, #36),
 * but RESP3 needs the server to support `HELLO 3` (Redis >= 6) and the
 * version of the Azure Container App `ffd-redis-*` image is not recorded in
 * this repository. Keep RESP2 until that version is confirmed; then this
 * constant can be dropped and ioredis' default used.
 */
export const REDIS_PROTOCOL = 2;

/**
 * Connection options for `BullModule.forRootAsync`. BullMQ builds its own
 * ioredis clients from these plain options, so whatever is set (or not set)
 * here is what the queue speaks on the wire. Shared with the integration
 * test so it exercises the exact production configuration.
 */
export function buildBullConnection(configService: ConfigService): {
  connection: RedisOptions;
} {
  return {
    connection: {
      host: configService.get<string>("REDIS_HOST", "localhost"),
      port: configService.get<number>("REDIS_PORT", 6379),
      password: configService.get<string>("REDIS_PASSWORD"),
      protocol: REDIS_PROTOCOL,
    },
  };
}
