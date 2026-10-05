import { Test, TestingModule } from "@nestjs/testing";
import { NextFunction, Request, Response } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "./metrics.service";
import { DbPerformanceMiddleware } from "./db-performance.middleware";

describe("DbPerformanceMiddleware", () => {
  let middleware: DbPerformanceMiddleware;
  const mockMetricsService = {
    recordDatabaseMetric: jest.fn(),
  };
  const mockPrisma = {
    $queryRaw: undefined,
    $executeRaw: undefined,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbPerformanceMiddleware,
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    middleware = module.get<DbPerformanceMiddleware>(DbPerformanceMiddleware);
  });

  it("calls next() when use() is invoked", () => {
    const req = {} as Request;
    const res = {} as Response;
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
