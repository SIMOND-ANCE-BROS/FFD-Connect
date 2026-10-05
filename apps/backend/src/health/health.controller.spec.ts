import { HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Response } from "express";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  let controller: HealthController;
  let healthService: HealthService;

  const mockHealthService = {
    check: jest.fn(),
    getMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockHealthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("live", () => {
    it("should return status ok", () => {
      expect(controller.live()).toEqual({ status: "ok" });
    });
  });

  describe("check", () => {
    const makeRes = () => ({ status: jest.fn() }) as unknown as Response;

    it("should return health status from service and not override 200 when ok", async () => {
      const mockStatus = {
        status: "ok" as const,
        version: "test-sha",
        timestamp: "2026-02-17T12:00:00.000Z",
        uptime: 3600,
        database: { status: "ok" as const, responseTime: 1 },
        redis: { status: "ok" as const, responseTime: 2 },
        memory: { used: 50e6, total: 128e6, percentage: 39 },
      };
      mockHealthService.check.mockResolvedValue(mockStatus);
      const res = makeRes();

      const result = await controller.check(res);
      expect(result).toEqual(mockStatus);
      expect(healthService.check).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should set HTTP 503 when status is down (DB + Redis both unreachable)", async () => {
      const mockStatus = {
        status: "down" as const,
        version: "test-sha",
        timestamp: "2026-02-17T12:00:00.000Z",
        uptime: 3600,
        database: { status: "error" as const, error: "connection refused" },
        redis: { status: "error" as const, error: "connection refused" },
        memory: { used: 50e6, total: 128e6, percentage: 39 },
      };
      mockHealthService.check.mockResolvedValue(mockStatus);
      const res = makeRes();

      const result = await controller.check(res);
      expect(result).toEqual(mockStatus);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it("should keep HTTP 200 when status is degraded", async () => {
      const mockStatus = {
        status: "degraded" as const,
        version: "test-sha",
        timestamp: "2026-02-17T12:00:00.000Z",
        uptime: 3600,
        database: { status: "ok" as const, responseTime: 1 },
        redis: { status: "error" as const, error: "connection refused" },
        memory: { used: 50e6, total: 128e6, percentage: 39 },
      };
      mockHealthService.check.mockResolvedValue(mockStatus);
      const res = makeRes();

      await controller.check(res);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("metrics", () => {
    it("should return metrics from service", () => {
      const mockMetrics = {
        uptime: 3600,
        memory: { heapUsed: 50e6, heapTotal: 128e6, external: 0, rss: 80e6 },
        cpu: { usage: 1.5 },
        requests: { total: 100, errors: 2 },
      };
      mockHealthService.getMetrics.mockReturnValue(mockMetrics);

      const result = controller.metrics();
      expect(result).toEqual(mockMetrics);

      expect(healthService.getMetrics).toHaveBeenCalled();
    });
  });
});
