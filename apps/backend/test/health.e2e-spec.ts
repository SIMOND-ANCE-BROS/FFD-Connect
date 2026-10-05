import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { HealthService } from "./../src/health/health.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("HealthController (e2e)", () => {
  let app: INestApplication;
  let healthService: HealthService;
  let prismaService: PrismaService;
  let redisService: RedisService;

  beforeAll(async () => {
    const mockRedisClient = {
      ping: jest.fn().mockResolvedValue("PONG"),
    };

    const mockRedisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      isAvailable: jest.fn().mockReturnValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByPattern: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(false),
      onModuleDestroy: jest.fn(),
    };

    const mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(RedisService)
        .useValue(mockRedisService)
        .overrideProvider(PrismaService)
        .useValue(mockPrisma),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    healthService = moduleFixture.get<HealthService>(HealthService);
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    redisService = moduleFixture.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset mocks to defaults before each test
    (prismaService.$queryRaw as jest.Mock).mockResolvedValue([
      { "?column?": 1 },
    ]);
    const mockRedisClient = {
      ping: jest.fn().mockResolvedValue("PONG"),
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisService.isAvailable as jest.Mock).mockReturnValue(true);
  });

  describe("/health (GET)", () => {
    it("should return health status", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("status");
          expect(res.body).toHaveProperty("timestamp");
          expect(res.body).toHaveProperty("uptime");
          expect(res.body).toHaveProperty("database");
          expect(res.body).toHaveProperty("redis");
          expect(res.body).toHaveProperty("memory");
          expect(["ok", "degraded", "down"]).toContain(res.body.status);
        });
    });

    it("should include database status", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body.database).toHaveProperty("status");
          expect(["ok", "error"]).toContain(res.body.database.status);
        });
    });

    it("should include redis status", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body.redis).toHaveProperty("status");
          expect(["ok", "error"]).toContain(res.body.redis.status);
        });
    });

    it("should include memory information", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(typeof res.body.memory.rss).toBe("number");
          expect(typeof res.body.memory.limit).toBe("number");
          expect(["cgroup", "os"]).toContain(res.body.memory.limitSource);
          expect(typeof res.body.memory.rssPercentOfLimit).toBe("number");
          expect(typeof res.body.memory.heapUsed).toBe("number");
          expect(typeof res.body.memory.heapTotal).toBe("number");
          expect(typeof res.body.memory.heapUsedPercentOfHeapTotal).toBe(
            "number",
          );
        });
    });

    // #44: the old payload published heapUsed/heapTotal as `percentage`, which
    // sat in the 90s on a healthy process and was read as container saturation.
    it("should not publish a percentage that reads as container saturation", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body.memory).not.toHaveProperty("percentage");
          // The test process is not capped by a cgroup, so this is rss over
          // the host RAM — a genuinely small share, never a 90-something.
          expect(res.body.memory.rssPercentOfLimit).toBeLessThan(90);
        });
    });

    // #43: /health must stay at the root. The deployment smoke test polls it
    // and rolls back when `version` does not match the SHA it deployed.
    it("should not be reachable under the api/v1 prefix", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/health")
        .expect(404);
    });

    it("should serve /health/live at the root", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health/live")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: "ok" });
        });
    });

    it("should handle database errors gracefully", async () => {
      (prismaService.$queryRaw as jest.Mock).mockRejectedValue(
        new Error("Database connection failed"),
      );

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body.database.status).toBe("error");
          expect(res.body.database).toHaveProperty("error");
          expect(res.body.status).toBe("degraded");
        });
    });

    it("should handle redis errors gracefully", async () => {
      const mockRedisClient = {
        ping: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
      };
      (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health")
        .expect(200)
        .expect((res) => {
          expect(res.body.redis.status).toBe("error");
          expect(res.body.redis).toHaveProperty("error");
        });
    });
  });

  describe("/health/metrics (GET)", () => {
    it("should return application metrics", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health/metrics")
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("uptime");
          expect(res.body).toHaveProperty("memory");
          expect(res.body).toHaveProperty("cpu");
          expect(res.body).toHaveProperty("requests");
          expect(typeof res.body.uptime).toBe("number");
          expect(res.body.memory).toHaveProperty("heapUsed");
          expect(res.body.memory).toHaveProperty("heapTotal");
          expect(res.body.requests).toHaveProperty("total");
          expect(res.body.requests).toHaveProperty("errors");
        });
    });

    it("should track request counts", () => {
      healthService.incrementRequestCount();
      healthService.incrementRequestCount();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health/metrics")
        .expect(200)
        .expect((res) => {
          expect(res.body.requests.total).toBeGreaterThanOrEqual(2);
        });
    });

    it("should track error counts", () => {
      healthService.incrementErrorCount();
      healthService.incrementErrorCount();
      healthService.incrementErrorCount();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/health/metrics")
        .expect(200)
        .expect((res) => {
          expect(res.body.requests.errors).toBeGreaterThanOrEqual(3);
        });
    });
  });
});
