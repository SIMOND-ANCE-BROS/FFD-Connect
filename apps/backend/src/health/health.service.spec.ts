import { getQueueToken } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;
  const mockPrisma = {
    $queryRaw: jest.fn(),
  };

  const mockRedisClient = {
    ping: jest.fn(),
  };

  const mockRedisService = {
    isAvailable: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  const mockSyncQueue = {
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      failed: 0,
      delayed: 0,
      completed: 0,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: getQueueToken("ffd-sync"), useValue: mockSyncQueue },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockRedisClient.ping.mockResolvedValue("PONG");
    mockRedisService.isAvailable.mockReturnValue(true);
    mockRedisService.getClient.mockReturnValue(mockRedisClient);
    mockSyncQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      failed: 0,
      delayed: 0,
      completed: 0,
    });
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("check", () => {
    it("should return ok status when db and redis are healthy", async () => {
      const result = await service.check();
      expect(result.status).toBe("ok");
      expect(result.database.status).toBe("ok");
      expect(result.redis.status).toBe("ok");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("uptime");
      expect(result).toHaveProperty("memory");
    });

    it("should return degraded when database fails", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection refused"));

      const result = await service.check();
      expect(result.status).toBe("degraded");
      expect(result.database.status).toBe("error");
      expect(result.database.error).toBeTruthy();
      expect(result.redis.status).toBe("ok");
    });

    it("should return degraded when redis fails", async () => {
      mockRedisService.isAvailable.mockReturnValue(false);

      const result = await service.check();
      expect(result.status).toBe("degraded");
      expect(result.database.status).toBe("ok");
      expect(result.redis.status).toBe("error");
      expect(result.redis.error).toBe("Redis not available");
    });

    it("should return degraded when redis client is null", async () => {
      mockRedisService.getClient.mockReturnValue(null);

      const result = await service.check();
      expect(result.status).toBe("degraded");
      expect(result.redis.status).toBe("error");
      expect(result.redis.error).toBe("Redis client not initialized");
    });

    it("should return degraded when redis ping fails", async () => {
      mockRedisClient.ping.mockRejectedValue(new Error("Connection timeout"));

      const result = await service.check();
      expect(result.status).toBe("degraded");
      expect(result.redis.status).toBe("error");
    });

    it("should return down when both db and redis fail", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("DB down"));
      mockRedisService.isAvailable.mockReturnValue(false);

      const result = await service.check();
      expect(result.status).toBe("down");
      expect(result.database.status).toBe("error");
      expect(result.redis.status).toBe("error");
    });
  });

  describe("queues", () => {
    it("should include queue metrics in health check result", async () => {
      const result = await service.check();
      expect(result).toHaveProperty("queues");
      expect(result.queues["ffd-sync"]).toEqual({
        status: "ok",
        waiting: 0,
        active: 0,
        failed: 0,
      });
    });

    it("stays ok when a queue has failed jobs (user-driven, not an infra signal)", async () => {
      mockSyncQueue.getJobCounts.mockResolvedValue({
        waiting: 0,
        active: 0,
        failed: 5,
        delayed: 0,
        completed: 10,
      });

      const result = await service.check();
      // Failed jobs must not degrade infra health.
      expect(result.status).toBe("ok");
      expect(result.queues["ffd-sync"].status).toBe("ok");
      // ...but the count is still surfaced for visibility.
      expect(result.queues["ffd-sync"].failed).toBe(5);
    });

    it("should return degraded status when a queue has stalled jobs (waiting > 100)", async () => {
      mockSyncQueue.getJobCounts.mockResolvedValue({
        waiting: 150,
        active: 0,
        failed: 0,
        delayed: 0,
        completed: 0,
      });

      const result = await service.check();
      expect(result.status).toBe("degraded");
      expect(result.queues["ffd-sync"].status).toBe("degraded");
      expect(result.queues["ffd-sync"].waiting).toBe(150);
    });

    it("should return error in queue status when getJobCounts throws", async () => {
      mockSyncQueue.getJobCounts.mockRejectedValue(new Error("Redis timeout"));

      const result = await service.check();
      expect(result.queues["ffd-sync"].status).toBe("error");
      expect(result.queues["ffd-sync"]).toHaveProperty("error");
      expect(result.status).toBe("degraded");
    });
  });

  describe("getMetrics", () => {
    it("should return metrics with uptime, memory, cpu, requests", () => {
      const result = service.getMetrics();
      expect(result).toHaveProperty("uptime");
      expect(result).toHaveProperty("memory");
      expect(result.memory).toHaveProperty("heapUsed");
      expect(result.memory).toHaveProperty("heapTotal");
      expect(result.memory).toHaveProperty("external");
      expect(result.memory).toHaveProperty("rss");
      expect(result).toHaveProperty("cpu");
      expect(result.cpu).toHaveProperty("usage");
      expect(result).toHaveProperty("requests");
      expect(result.requests).toEqual({ total: 0, errors: 0 });
    });
  });

  describe("incrementRequestCount / incrementErrorCount", () => {
    it("should increment request and error counters", () => {
      service.incrementRequestCount();
      service.incrementRequestCount();
      service.incrementErrorCount();

      const result = service.getMetrics();
      expect(result.requests.total).toBe(2);
      expect(result.requests.errors).toBe(1);
    });
  });
});
