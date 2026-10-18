import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  ADMIN_AUDIT_LOG_MAX_BATCHES_PER_PASS,
  ADMIN_AUDIT_LOG_PURGE_BATCH,
  ADMIN_AUDIT_LOG_RETENTION_ENV,
  AdminAuditLogRetentionService,
  DEFAULT_ADMIN_AUDIT_LOG_RETENTION_DAYS,
  resolveAdminAuditLogRetentionDays,
} from "./admin-audit-log-retention.service";

const configWith = (values: Record<string, unknown> = {}) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const ids = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${offset + i}` }));

describe("AdminAuditLogRetentionService (#741)", () => {
  const prisma = {
    adminAuditLog: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const NOW = new Date("2027-06-15T12:00:00.000Z");

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.adminAuditLog.deleteMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve({ count: where.id.in.length }),
    );
  });

  const service = (values: Record<string, unknown> = {}) =>
    new AdminAuditLogRetentionService(
      prisma as unknown as PrismaService,
      configWith(values),
    );

  describe("retention setting", () => {
    it("defaults to 365 days", () => {
      expect(DEFAULT_ADMIN_AUDIT_LOG_RETENTION_DAYS).toBe(365);
      expect(resolveAdminAuditLogRetentionDays(configWith())).toBe(365);
    });

    it.each([
      ["30", 30],
      [730, 730],
      ["3650", 3650],
    ])("reads %p from the config", (raw, expected) => {
      expect(
        resolveAdminAuditLogRetentionDays(
          configWith({ [ADMIN_AUDIT_LOG_RETENTION_ENV]: raw }),
        ),
      ).toBe(expected);
    });

    it.each(["29", "3651", "abc", "12.5", "", -1])(
      "falls back to the default for %p",
      (raw) => {
        expect(
          resolveAdminAuditLogRetentionDays(
            configWith({ [ADMIN_AUDIT_LOG_RETENTION_ENV]: raw }),
          ),
        ).toBe(365);
      },
    );
  });

  describe("purge", () => {
    it("deletes the rows older than the retention, oldest first, bounded", async () => {
      prisma.adminAuditLog.findMany.mockResolvedValueOnce(ids(3));

      await expect(service().purge(NOW)).resolves.toBe(3);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date("2026-06-15T12:00:00.000Z") } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
        take: ADMIN_AUDIT_LOG_PURGE_BATCH,
      });
      expect(prisma.adminAuditLog.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["row-0", "row-1", "row-2"] } },
      });
      // A short batch means nothing is left: no second read.
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledTimes(1);
    });

    it("uses the configured retention for the cutoff", async () => {
      prisma.adminAuditLog.findMany.mockResolvedValueOnce([]);

      await service({ [ADMIN_AUDIT_LOG_RETENTION_ENV]: "30" }).purge(NOW);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { lt: new Date("2027-05-16T12:00:00.000Z") } },
        }),
      );
    });

    it("does nothing when no row is expired", async () => {
      prisma.adminAuditLog.findMany.mockResolvedValueOnce([]);

      await expect(service().purge(NOW)).resolves.toBe(0);
      expect(prisma.adminAuditLog.deleteMany).not.toHaveBeenCalled();
    });

    it("keeps reading full batches, at most the per-pass bound", async () => {
      prisma.adminAuditLog.findMany.mockImplementation(() =>
        Promise.resolve(ids(ADMIN_AUDIT_LOG_PURGE_BATCH)),
      );

      await expect(service().purge(NOW)).resolves.toBe(
        ADMIN_AUDIT_LOG_PURGE_BATCH * ADMIN_AUDIT_LOG_MAX_BATCHES_PER_PASS,
      );
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledTimes(
        ADMIN_AUDIT_LOG_MAX_BATCHES_PER_PASS,
      );
    });

    it("stops after the first short batch of a backlog", async () => {
      prisma.adminAuditLog.findMany
        .mockResolvedValueOnce(ids(ADMIN_AUDIT_LOG_PURGE_BATCH))
        .mockResolvedValueOnce(ids(5, ADMIN_AUDIT_LOG_PURGE_BATCH));

      await expect(service().purge(NOW)).resolves.toBe(
        ADMIN_AUDIT_LOG_PURGE_BATCH + 5,
      );
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
