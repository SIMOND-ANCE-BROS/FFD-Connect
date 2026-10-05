import { Test, TestingModule } from "@nestjs/testing";
import { CompetitionCacheService } from "./competition-cache.service";
import { RedisService } from "../../redis/redis.service";

describe("CompetitionCacheService", () => {
  let service: CompetitionCacheService;
  let redisService: jest.Mocked<
    Pick<RedisService, "delete" | "deleteByPattern">
  >;

  beforeEach(async () => {
    redisService = {
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByPattern: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionCacheService,
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<CompetitionCacheService>(CompetitionCacheService);
  });

  describe("invalidateAll", () => {
    it("calls deleteByPattern with 'competitions:*'", async () => {
      await service.invalidateAll();

      expect(redisService.deleteByPattern).toHaveBeenCalledTimes(1);
      expect(redisService.deleteByPattern).toHaveBeenCalledWith(
        "competitions:*",
      );
    });

    it("does not call delete directly", async () => {
      await service.invalidateAll();

      expect(redisService.delete).not.toHaveBeenCalled();
    });
  });

  describe("invalidateCompetition", () => {
    it("deletes the specific competition key when called without userId", async () => {
      await service.invalidateCompetition("comp-42");

      expect(redisService.delete).toHaveBeenCalledWith(
        "competitions:one:comp-42",
      );
    });

    it("deletes the public pattern when called without userId", async () => {
      await service.invalidateCompetition("comp-42");

      expect(redisService.deleteByPattern).toHaveBeenCalledWith(
        "competitions:all:public*",
      );
    });

    it("makes exactly 2 redis calls when no userId is provided", async () => {
      await service.invalidateCompetition("comp-42");

      expect(redisService.delete).toHaveBeenCalledTimes(1);
      expect(redisService.deleteByPattern).toHaveBeenCalledTimes(1);
    });

    it("also deletes user-scoped pattern when userId is provided", async () => {
      await service.invalidateCompetition("comp-42", "user-99");

      expect(redisService.deleteByPattern).toHaveBeenCalledWith(
        "competitions:all:user-99*",
      );
    });

    it("makes exactly 3 redis calls when userId is provided", async () => {
      await service.invalidateCompetition("comp-42", "user-99");

      // delete: 1 (specific competition key)
      expect(redisService.delete).toHaveBeenCalledTimes(1);
      // deleteByPattern: 2 (public* and userId*)
      expect(redisService.deleteByPattern).toHaveBeenCalledTimes(2);
    });

    it("includes both public pattern and user pattern when userId is provided", async () => {
      await service.invalidateCompetition("comp-42", "user-99");

      expect(redisService.deleteByPattern).toHaveBeenCalledWith(
        "competitions:all:public*",
      );
      expect(redisService.deleteByPattern).toHaveBeenCalledWith(
        "competitions:all:user-99*",
      );
    });
  });

  describe("invalidateResults", () => {
    it("calls delete with the results key for the given competitionId", async () => {
      await service.invalidateResults("comp-7");

      expect(redisService.delete).toHaveBeenCalledTimes(1);
      expect(redisService.delete).toHaveBeenCalledWith(
        "competitions:results:comp-7",
      );
    });

    it("does not call deleteByPattern", async () => {
      await service.invalidateResults("comp-7");

      expect(redisService.deleteByPattern).not.toHaveBeenCalled();
    });
  });
});
