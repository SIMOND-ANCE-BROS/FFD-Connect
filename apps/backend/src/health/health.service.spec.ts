import { getQueueToken } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { resolveMemoryLimit } from "./container-memory.util";
import { HealthService } from "./health.service";

// Only the cgroup-reading seam is faked; the percentage arithmetic stays real.
jest.mock("./container-memory.util", () => ({
  ...jest.requireActual<typeof import("./container-memory.util")>(
    "./container-memory.util",
  ),
  resolveMemoryLimit: jest.fn(),
}));

const GIBIBYTE = 1024 ** 3;

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
    jest
      .mocked(resolveMemoryLimit)
      .mockReturnValue({ bytes: GIBIBYTE, source: "cgroup" });
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

  /**
   * Regression guard for #44: `/health` used to publish
   * `heapUsed / heapTotal` under the name `percentage`. That is the V8 heap
   * fill ratio — normally high — and it read as container saturation: 94 % on
   * a healthy backend sized at 1 Gi, which misled a deployment check.
   */
  describe("memory", () => {
    /** The exact figures from the issue: ~79 MB of heap inside a 1 Gi app. */
    const USAGE: NodeJS.MemoryUsage = {
      rss: 82_837_504,
      heapTotal: 84_381_696,
      heapUsed: 78_993_784,
      external: 2_000_000,
      arrayBuffers: 100_000,
    };

    beforeEach(() => {
      jest.spyOn(process, "memoryUsage").mockReturnValue(USAGE);
    });

    afterEach(() => {
      jest.mocked(process.memoryUsage).mockRestore();
    });

    it("reports rss against the container limit, not the heap ratio", async () => {
      const { memory } = await service.check();

      expect(memory.rss).toBe(USAGE.rss);
      expect(memory.limit).toBe(GIBIBYTE);
      expect(memory.limitSource).toBe("cgroup");
      // ~79 MB of 1 Gi — the real situation the issue describes, not 94 %.
      expect(memory.rssPercentOfLimit).toBeCloseTo(7.7, 1);
    });

    it("never publishes a bare `percentage` that reads as saturation", async () => {
      const { memory } = await service.check();

      expect(memory).not.toHaveProperty("percentage");
      expect(memory).not.toHaveProperty("used");
      expect(memory).not.toHaveProperty("total");
      expect(
        Object.values(memory).filter(
          (value) => typeof value === "number" && value > 90 && value <= 100,
        ),
      ).toEqual([
        // The only value in that range is the heap ratio, and it is named
        // after what it divides by.
        memory.heapUsedPercentOfHeapTotal,
      ]);
    });

    it("keeps the heap ratio under an unambiguous name", async () => {
      const { memory } = await service.check();

      expect(memory.heapUsed).toBe(USAGE.heapUsed);
      expect(memory.heapTotal).toBe(USAGE.heapTotal);
      expect(memory.heapUsedPercentOfHeapTotal).toBeCloseTo(93.6, 1);
    });

    it("falls back to the host RAM when no cgroup limit exists (dev machine)", async () => {
      jest
        .mocked(resolveMemoryLimit)
        .mockReturnValue({ bytes: 64 * GIBIBYTE, source: "os" });

      const { memory } = await service.check();

      expect(memory.limitSource).toBe("os");
      expect(memory.limit).toBe(64 * GIBIBYTE);
      // One decimal, so a small share does not collapse to a flat 0.
      expect(memory.rssPercentOfLimit).toBeCloseTo(0.1, 1);
    });

    it("resolves the limit once — /health must not read the cgroup per probe", async () => {
      await service.check();
      await service.check();
      await service.check();

      expect(resolveMemoryLimit).toHaveBeenCalledTimes(1);
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
