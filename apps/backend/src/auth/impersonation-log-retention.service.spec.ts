import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  impersonationLogIpSelect,
} from "../utils/prisma-selects";
import {
  DEFAULT_IMPERSONATION_LOG_IP_RETENTION_DAYS,
  DEFAULT_IMPERSONATION_LOG_RETENTION_DAYS,
  IMPERSONATION_LOG_IP_BATCH,
  IMPERSONATION_LOG_MAX_BATCHES_PER_PASS,
  IMPERSONATION_LOG_PURGE_BATCH,
  ImpersonationLogRetentionService,
  resolveImpersonationLogRetention,
} from "./impersonation-log-retention.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-17T12:00:00Z");

const configWith = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const ids = (n: number, prefix = "r") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe("resolveImpersonationLogRetention (#731)", () => {
  it("defaults to 365 days for rows and 90 days for the full IP", () => {
    expect(resolveImpersonationLogRetention(configWith({}))).toEqual({
      rowDays: DEFAULT_IMPERSONATION_LOG_RETENTION_DAYS,
      ipDays: DEFAULT_IMPERSONATION_LOG_IP_RETENTION_DAYS,
    });
    expect(DEFAULT_IMPERSONATION_LOG_RETENTION_DAYS).toBe(365);
    expect(DEFAULT_IMPERSONATION_LOG_IP_RETENTION_DAYS).toBe(90);
  });

  it("reads numbers and numeric strings from the config", () => {
    expect(
      resolveImpersonationLogRetention(
        configWith({
          IMPERSONATION_LOG_RETENTION_DAYS: "180",
          IMPERSONATION_LOG_IP_RETENTION_DAYS: 30,
        }),
      ),
    ).toEqual({ rowDays: 180, ipDays: 30 });
  });

  it("accepts 0 days for the IP (truncated at the first pass)", () => {
    expect(
      resolveImpersonationLogRetention(
        configWith({ IMPERSONATION_LOG_IP_RETENTION_DAYS: "0" }),
      ).ipDays,
    ).toBe(0);
  });

  it.each([["29"], ["3651"], ["12.5"], ["abc"], [""], ["  "], [true], [-1]])(
    "falls back to 365 days on an invalid row retention (%p)",
    (value) => {
      expect(
        resolveImpersonationLogRetention(
          configWith({ IMPERSONATION_LOG_RETENTION_DAYS: value }),
        ).rowDays,
      ).toBe(365);
    },
  );

  it.each([["-1"], ["3651"], ["1.5"], ["abc"], [""], [null], [false]])(
    "falls back to 90 days on an invalid IP retention (%p)",
    (value) => {
      expect(
        resolveImpersonationLogRetention(
          configWith({ IMPERSONATION_LOG_IP_RETENTION_DAYS: value }),
        ).ipDays,
      ).toBe(90);
    },
  );

  it("accepts the bounds of the row retention", () => {
    for (const days of [30, 3650]) {
      expect(
        resolveImpersonationLogRetention(
          configWith({ IMPERSONATION_LOG_RETENTION_DAYS: days }),
        ).rowDays,
      ).toBe(days);
    }
  });

  it("never keeps the full IP longer than the row itself", () => {
    expect(
      resolveImpersonationLogRetention(
        configWith({
          IMPERSONATION_LOG_RETENTION_DAYS: 60,
          IMPERSONATION_LOG_IP_RETENTION_DAYS: 400,
        }),
      ),
    ).toEqual({ rowDays: 60, ipDays: 60 });
  });
});

describe("ImpersonationLogRetentionService (#731)", () => {
  const prisma = {
    impersonationLog: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: ImpersonationLogRetentionService;

  /** findMany answers: first the delete batches, then the IP batches. */
  const batches = (
    deleteBatches: { id: string }[][],
    ipBatches: { id: string; ip: string | null }[][] = [],
  ) => {
    prisma.impersonationLog.findMany.mockImplementation(
      (args: { select: unknown }) => {
        const queue = args.select === idOnlySelect ? deleteBatches : ipBatches;
        return Promise.resolve(queue.shift() ?? []);
      },
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.impersonationLog.deleteMany.mockImplementation(
      (args: { where: { id: { in: string[] } } }) =>
        Promise.resolve({ count: args.where.id.in.length }),
    );
    prisma.impersonationLog.update.mockImplementation(
      (args: { where: { id: string }; data: { ip: string | null } }) => args,
    );
    prisma.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.resolve(ops),
    );
    service = new ImpersonationLogRetentionService(
      prisma as unknown as PrismaService,
      configWith({}),
    );
  });

  it("does nothing on an empty journal", async () => {
    batches([]);
    await expect(service.purge(NOW)).resolves.toEqual({
      deleted: 0,
      ipTruncated: 0,
    });
    expect(prisma.impersonationLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the rows started more than 365 days ago, oldest first, bounded", async () => {
    batches([ids(3)]);
    await expect(service.purge(NOW)).resolves.toMatchObject({ deleted: 3 });
    expect(prisma.impersonationLog.findMany).toHaveBeenCalledWith({
      where: { startedAt: { lt: new Date(NOW.getTime() - 365 * DAY_MS) } },
      orderBy: { startedAt: "asc" },
      select: idOnlySelect,
      take: IMPERSONATION_LOG_PURGE_BATCH,
    });
    expect(prisma.impersonationLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r0", "r1", "r2"] } },
    });
  });

  it("drains a backlog over several batches, at most a fixed number per pass", async () => {
    const full = () => ids(IMPERSONATION_LOG_PURGE_BATCH);
    batches(
      Array.from({ length: IMPERSONATION_LOG_MAX_BATCHES_PER_PASS + 2 }, full),
    );
    const { deleted } = await service.purge(NOW);
    expect(deleted).toBe(
      IMPERSONATION_LOG_PURGE_BATCH * IMPERSONATION_LOG_MAX_BATCHES_PER_PASS,
    );
    expect(prisma.impersonationLog.deleteMany).toHaveBeenCalledTimes(
      IMPERSONATION_LOG_MAX_BATCHES_PER_PASS,
    );
  });

  it("stops after a partial batch", async () => {
    batches([ids(IMPERSONATION_LOG_PURGE_BATCH), ids(2, "s"), ids(5, "t")]);
    await expect(service.purge(NOW)).resolves.toMatchObject({
      deleted: IMPERSONATION_LOG_PURGE_BATCH + 2,
    });
    expect(prisma.impersonationLog.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("reduces the full IP of rows older than 90 days to its network", async () => {
    batches(
      [],
      [
        [
          { id: "a", ip: "203.0.113.42" },
          { id: "b", ip: "2001:db8:abcd:12::1" },
          { id: "c", ip: "::ffff:198.51.100.7" },
          { id: "d", ip: "" },
          { id: "e", ip: "not-an-ip" },
        ],
      ],
    );
    await expect(service.purge(NOW)).resolves.toEqual({
      deleted: 0,
      ipTruncated: 5,
    });
    expect(prisma.impersonationLog.findMany).toHaveBeenCalledWith({
      where: {
        startedAt: { lt: new Date(NOW.getTime() - 90 * DAY_MS) },
        ip: { not: null },
        NOT: [{ ip: { contains: "/" } }, { ip: "unknown" }],
      },
      orderBy: { startedAt: "asc" },
      select: impersonationLogIpSelect,
      take: IMPERSONATION_LOG_IP_BATCH,
    });
    const written = prisma.impersonationLog.update.mock.calls.map(
      ([args]: [{ where: { id: string }; data: { ip: string | null } }]) => [
        args.where.id,
        args.data.ip,
      ],
    );
    expect(written).toEqual([
      ["a", "203.0.113.0/24"],
      ["b", "2001:db8:abcd::/48"],
      ["c", "198.51.100.0/24"],
      ["d", null],
      ["e", "unknown"],
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("bounds the IP truncation per pass too", async () => {
    const full = () =>
      Array.from({ length: IMPERSONATION_LOG_IP_BATCH }, (_, i) => ({
        id: `ip${i}`,
        ip: "203.0.113.42",
      }));
    batches(
      [],
      Array.from({ length: IMPERSONATION_LOG_MAX_BATCHES_PER_PASS + 1 }, full),
    );
    await expect(service.purge(NOW)).resolves.toMatchObject({
      ipTruncated:
        IMPERSONATION_LOG_IP_BATCH * IMPERSONATION_LOG_MAX_BATCHES_PER_PASS,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(
      IMPERSONATION_LOG_MAX_BATCHES_PER_PASS,
    );
  });

  it("uses the configured retention", async () => {
    service = new ImpersonationLogRetentionService(
      prisma as unknown as PrismaService,
      configWith({
        IMPERSONATION_LOG_RETENTION_DAYS: "180",
        IMPERSONATION_LOG_IP_RETENTION_DAYS: "7",
      }),
    );
    batches([]);
    await service.purge(NOW);
    const cutoffs = prisma.impersonationLog.findMany.mock.calls.map(
      ([args]: [{ where: { startedAt: { lt: Date } } }]) =>
        args.where.startedAt.lt.getTime(),
    );
    expect(cutoffs).toEqual([
      NOW.getTime() - 180 * DAY_MS,
      NOW.getTime() - 7 * DAY_MS,
    ]);
  });

  it("defaults `now` to the current time", async () => {
    batches([]);
    const before = Date.now();
    await service.purge();
    const [[args]] = prisma.impersonationLog.findMany.mock.calls as [
      [{ where: { startedAt: { lt: Date } } }],
    ];
    expect(args.where.startedAt.lt.getTime()).toBeGreaterThanOrEqual(
      before - 365 * DAY_MS,
    );
  });
});
