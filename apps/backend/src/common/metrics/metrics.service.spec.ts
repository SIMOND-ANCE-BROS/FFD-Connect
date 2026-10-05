import { Test, TestingModule } from "@nestjs/testing";
import { PinoLogger } from "nestjs-pino";
import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;
  const mockLogger = {
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockImplementation(() => ({}) as ReturnType<typeof setInterval>);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    service.onModuleInit();
    setIntervalSpy.mockRestore();
  });

  describe("recordHttpMetric", () => {
    it("does not warn for a fast successful request", () => {
      service.recordHttpMetric({
        endpoint: "/api/health",
        method: "GET",
        duration: 100,
        statusCode: 200,
        timestamp: new Date(),
      });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("logs a warning when request is slow (> 1s)", () => {
      service.recordHttpMetric({
        endpoint: "/api/slow",
        method: "GET",
        duration: 1500,
        statusCode: 200,
        timestamp: new Date(),
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("recordDatabaseMetric", () => {
    it("does not log for fast query (< 500ms)", () => {
      service.recordDatabaseMetric({
        query: "SELECT 1",
        duration: 100,
        timestamp: new Date(),
      });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("logs a warning for slow query (> 500ms)", () => {
      service.recordDatabaseMetric({
        query: "SELECT * FROM users WHERE ...",
        duration: 600,
        timestamp: new Date(),
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("onModuleInit", () => {
    it("registers a setInterval that calls logSystemMetrics", () => {
      let capturedCallback: () => void;
      const setIntervalSpy = jest
        .spyOn(global, "setInterval")
        .mockImplementation((cb: () => void) => {
          capturedCallback = cb;
          return {} as ReturnType<typeof setInterval>;
        });

      const logSystemMetricsSpy = jest
        .spyOn(service as any, "logSystemMetrics")
        .mockImplementation(() => {});

      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

      capturedCallback!();
      expect(logSystemMetricsSpy).toHaveBeenCalledTimes(1);

      setIntervalSpy.mockRestore();
      logSystemMetricsSpy.mockRestore();
    });
  });

  describe("logSystemMetrics", () => {
    it("logs debug system metrics when heap usage is normal", () => {
      jest.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 120 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      (service as any).logSystemMetrics();

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: "system_metrics",
          memory: expect.objectContaining({
            heapUsed: "50.00MB",
            heapTotal: "100.00MB",
          }),
        }),
        "System metrics",
      );

      jest.restoreAllMocks();
    });

    it("logs a warning when heap usage exceeds 80%", () => {
      jest.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 90 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 120 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      (service as any).logSystemMetrics();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: "high_memory_usage",
          heapUsedMB: 90,
          heapTotalMB: 100,
          heapUsagePercent: "90.00",
        }),
        expect.stringContaining("High memory usage detected"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "system_metrics" }),
        "System metrics",
      );

      jest.restoreAllMocks();
    });

    it("does not warn when heap usage is exactly 80%", () => {
      jest.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 80 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 120 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      (service as any).logSystemMetrics();

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });
});
