import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

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
   * Invalidate results cache for a competition.
   */
  async invalidateResults(competitionId: string): Promise<void> {
    this.logger.debug(
      `Invalidating results cache for competition ${competitionId}`,
    );
    await this.redisService.delete(
      `${this.CACHE_PREFIX}results:${competitionId}`,
    );
  }
}
