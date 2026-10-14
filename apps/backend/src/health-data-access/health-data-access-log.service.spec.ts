import { PrismaService } from "../prisma/prisma.service";
import type { HealthDataAccessEntry } from "./dto/health-data-access-log.dto";
import {
  HEALTH_DATA_ACCESS_LOG_RETENTION_DAYS,
  HealthDataAccessLogService,
} from "./health-data-access-log.service";

describe("HealthDataAccessLogService", () => {
  const prisma = {
    healthDataAccessLog: { createMany: jest.fn(), deleteMany: jest.fn() },
  };
  const service = new HealthDataAccessLogService(
    prisma as unknown as PrismaService,
  );

  const entry: HealthDataAccessEntry = {
    subjectUserId: "user-1",
    actorUserId: "admin-1",
    actorRole: "ADMIN",
    action: "READ",
    resourceType: "LICENSE_RENEWAL_REQUEST",
    resourceId: "req-1",
    route: "GET /admin/license-renewals/:id",
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.healthDataAccessLog.createMany.mockResolvedValue({ count: 1 });
    prisma.healthDataAccessLog.deleteMany.mockResolvedValue({ count: 4 });
  });

  it("writes exactly the access fields, nothing else a caller may carry", async () => {
    const polluted = {
      ...entry,
      ocrData: { isApte: true },
      email: "x@y.fr",
    } as HealthDataAccessEntry;

    await service.recordOp([polluted]);

    expect(prisma.healthDataAccessLog.createMany).toHaveBeenCalledWith({
      data: [entry],
    });
  });

  it("record() writes the rows", async () => {
    await service.record([entry, { ...entry, resourceId: "req-2" }]);
    expect(prisma.healthDataAccessLog.createMany).toHaveBeenCalledWith({
      data: [entry, { ...entry, resourceId: "req-2" }],
    });
  });

  it("record() does not touch the database without entries", async () => {
    await service.record([]);
    expect(prisma.healthDataAccessLog.createMany).not.toHaveBeenCalled();
  });

  it("record() propagates a write failure (no trace, no access)", async () => {
    prisma.healthDataAccessLog.createMany.mockRejectedValue(new Error("down"));
    await expect(service.record([entry])).rejects.toThrow("down");
  });

  it("purges the rows older than one year", async () => {
    const now = new Date("2027-06-01T00:00:00.000Z");

    const removed = await service.purgeExpired(now);

    expect(HEALTH_DATA_ACCESS_LOG_RETENTION_DAYS).toBe(365);
    expect(removed).toBe(4);
    expect(prisma.healthDataAccessLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-06-01T00:00:00.000Z") } },
    });
  });

  it("purges relative to the current time by default", async () => {
    jest.useFakeTimers({ now: new Date("2027-01-01T00:00:00.000Z") });
    await service.purgeExpired();
    expect(prisma.healthDataAccessLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-01-01T00:00:00.000Z") } },
    });
    jest.useRealTimers();
  });
});
