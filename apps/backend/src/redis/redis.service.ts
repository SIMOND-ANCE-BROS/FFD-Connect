import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isRedisAvailable = false;

  constructor(private readonly configService: ConfigService) {
    const redisHost = this.configService.get<string>("REDIS_HOST", "localhost");
    const redisPort = this.configService.get<number>("REDIS_PORT", 6379);
    const redisPassword = this.configService.get<string>("REDIS_PASSWORD");

    this.client = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      // Pin RESP2. ioredis 6 defaults to protocol 3, and while its default
      // `replyMapping: "legacy"` keeps reply SHAPES identical to RESP2, the
      // handshake and server-side behaviour still change. Nothing here needs
      // RESP3, and no test exercises a real Redis (see issue #771), so we hold
      // the v5 wire format until the queue is genuinely covered.
      protocol: 2,
      lazyConnect: true,
      retryStrategy: (times) => {
        // Stop retrying after 3 attempts
        if (times > 3) {
          this.logger.warn("Redis unavailable - cache will use FS only");
          return null;
        }
        return Math.min(times * 100, 1000);
      },
      maxRetriesPerRequest: 1,
    });

    this.client.on("connect", () => {
      this.isRedisAvailable = true;
      this.logger.log(`✅ Redis connected at ${redisHost}:${redisPort}`);
    });

    this.client.on("error", (err) => {
      this.isRedisAvailable = false;
      // Only log once, not on every retry
      if (err.message.includes("ECONNREFUSED")) {
        this.logger.warn("⚠️  Redis not available - using FS cache only");
      }
    });

    // Try to connect but don't block startup
    this.client.connect().catch(() => {
      this.logger.warn(
        "Redis connection failed - continuing with FS cache only",
      );
    });
  }

  /**
   * Get a value from Redis cache
   */
  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isRedisAvailable) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(
        `Redis get failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Set a value in Redis cache with optional TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.isRedisAvailable) {
      return;
    }
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.warn(
        `Redis set failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Check if a key exists in Redis
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.isRedisAvailable) {
      return false;
    }
    try {
      return (await this.client.exists(key)) === 1;
    } catch (error) {
      this.logger.warn(
        `Redis exists("${key}") failed, returning false`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  /**
   * Delete a key from Redis
   */
  async delete(key: string): Promise<void> {
    if (!this.client || !this.isRedisAvailable) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(
        `Redis delete failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete all keys matching a pattern (e.g. "competitions:all:userId*")
   * Uses SCAN instead of KEYS to avoid blocking the Redis event loop.
   */
  async deleteByPattern(pattern: string): Promise<void> {
    if (!this.client || !this.isRedisAvailable) {
      return;
    }

    try {
      let cursor = "0";
      do {
        // scan returns [newCursor, matchingKeys]
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== "0");
    } catch (error) {
      this.logger.error(
        `Failed to delete keys by pattern ${pattern}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all keys matching a pattern
   * Warning: Use with caution in production. SCAN is preferred for deletion.
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.client || !this.isRedisAvailable) {
      return [];
    }
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.warn(
        `Redis keys("${pattern}") failed, returning []`,
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  /**
   * Get the Redis client instance (for health checks)
   */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isRedisAvailable && this.client !== null;
  }

  onModuleDestroy() {
    if (this.client) {
      this.logger.log("Disconnecting from Redis");
      this.client.disconnect();
    }
  }
}
