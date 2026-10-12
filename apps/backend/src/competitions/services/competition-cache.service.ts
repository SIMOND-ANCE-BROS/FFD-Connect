import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

/**
 * Version of the cached `GET /competitions/:id/results` payload. Bumped when
 * its shape changes so a new image never serves an entry an older image
 * wrote: v2 (#413) dropped `userId` and `createdAt` from each row (the v1
 * entries still held them, for up to the 1 h TTL).
 */
const RESULTS_CACHE_VERSION = "v2";

/** Redis key of the public results of a competition. */
export function resultsCacheKey(competitionId: string): string {
  return `competitions:results:${RESULTS_CACHE_VERSION}:${competitionId}`;
}

/** Pre-#413 key: still deleted on invalidation, never read. */
function legacyResultsCacheKey(competitionId: string): string {
  return `competitions:results:${competitionId}`;
}

@Injectable()
export class CompetitionCacheService {
  private readonly logger = new Logger(CompetitionCacheService.name);
  private readonly CACHE_PREFIX = "competitions:";

  constructor(private readonly redisService: RedisService) {}

  /**
   * Invalidate all competition-related caches.
   * Useful after a full sync.
   */
  async invalidateAll(): Promise<void> {
    this.logger.debug("Invalidating all competition caches");
    await this.redisService.deleteByPattern(`${this.CACHE_PREFIX}*`);
  }

  /**
   * Invalidate cache for a specific competition and/or user.
   */
  async invalidateCompetition(
    competitionId: string,
    userId?: string,
  ): Promise<void> {
    this.logger.debug(
      `Invalidating cache for competition ${competitionId}${userId ? ` and user ${userId}` : ""}`,
    );

    const tasks = [
      this.redisService.delete(`${this.CACHE_PREFIX}one:${competitionId}`),
      this.redisService.deleteByPattern(`${this.CACHE_PREFIX}all:public*`),
    ];

    if (userId) {
      tasks.push(
        this.redisService.deleteByPattern(`${this.CACHE_PREFIX}all:${userId}*`),
      );
    }

    await Promise.all(tasks);
  }

  /**
   * Invalidate results cache for a competition (current key, plus the
   * pre-#413 one so a rolled-back image never reads a stale entry).
   */
  async invalidateResults(competitionId: string): Promise<void> {
    this.logger.debug(
      `Invalidating results cache for competition ${competitionId}`,
    );
    await Promise.all([
      this.redisService.delete(resultsCacheKey(competitionId)),
      this.redisService.delete(legacyResultsCacheKey(competitionId)),
    ]);
  }
}
