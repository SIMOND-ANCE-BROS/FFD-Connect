import type { PrismaService } from "../prisma/prisma.service";
import { UsageRetentionService } from "./usage-retention.service";

const NOW = new Date("2026-10-10T10:00:00Z"); // Paris 2026-10-10, yesterday = 2026-10-09

function makePrisma(state: { lastDay: Date } | null, firstEvent: Date | null) {
  const tx = {
    usageDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    usageDailyActive: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    usageRollupState: { upsert: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  return {
    tx,
    prisma: {
      usageRollupState: {
        findUnique: jest.fn().mockResolvedValue(state),
        upsert: jest.fn().mockResolvedValue({}),
      },
      usageEvent: {
        findFirst: jest
          .fn()
          .mockResolvedValue(firstEvent ? { occurredAt: firstEvent } : null),
      },
      usageDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      usageDailyActive: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(3),
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
}

const service = (prisma: unknown) =>
  new UsageRetentionService(prisma as PrismaService);

describe("UsageRetentionService.rollup", () => {
  it("aggregates every finished day after the last one, up to yesterday", async () => {
    const { prisma, tx } = makePrisma(
      { lastDay: new Date("2026-10-07T00:00:00Z") },
      null,
    );
    await expect(service(prisma).rollup(NOW)).resolves.toEqual([
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.usageDaily.deleteMany).toHaveBeenCalledWith({
      where: { day: new Date("2026-10-08T00:00:00Z") },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4); // 2 inserts per day
    expect(tx.usageRollupState.upsert).toHaveBeenLastCalledWith({
      where: { id: 1 },
      create: { id: 1, lastDay: new Date("2026-10-09T00:00:00Z") },
      update: { lastDay: new Date("2026-10-09T00:00:00Z") },
    });
  });

  it("first run starts at the Paris day of the oldest event", async () => {
    const { prisma } = makePrisma(null, new Date("2026-10-08T22:30:00Z")); // Paris 2026-10-09
    await expect(service(prisma).rollup(NOW)).resolves.toEqual(["2026-10-09"]);
  });

  it("first run without any event records yesterday and aggregates nothing", async () => {
    const { prisma } = makePrisma(null, null);
    await expect(service(prisma).rollup(NOW)).resolves.toEqual([]);
    expect(prisma.usageRollupState.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, lastDay: new Date("2026-10-09T00:00:00Z") },
      update: {},
    });
  });

  it("caps the days per run", async () => {
    const { prisma } = makePrisma(
      { lastDay: new Date("2025-01-01T00:00:00Z") },
      null,
    );
    expect(await service(prisma).rollup(NOW)).toHaveLength(120);
  });

  it("nothing to do when yesterday is already aggregated", async () => {
    const { prisma } = makePrisma(
      { lastDay: new Date("2026-10-09T00:00:00Z") },
      null,
    );
    await expect(service(prisma).rollup(NOW)).resolves.toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("UsageRetentionService.purge", () => {
  // $executeRaw is a tagged template: calls[0] = [strings, cutIso, batch].
  const cutOf = (mock: jest.Mock) => mock.mock.calls[0][1] as string;

  it("never purges raw events of a day not yet aggregated", async () => {
    const { prisma } = makePrisma(
      { lastDay: new Date("2026-05-01T00:00:00Z") },
      null,
    );
    await service(prisma).purge(NOW);
    // start of 2026-05-02 in Paris, earlier than now - 90 days
    expect(cutOf(prisma.$executeRaw)).toBe("2026-05-01T22:00:00.000Z");
  });

  it("raw cut is now - 90 days when up to date; aggregates keep 25 months", async () => {
    const { prisma } = makePrisma(
      { lastDay: new Date("2026-10-09T00:00:00Z") },
      null,
    );
    await expect(service(prisma).purge(NOW)).resolves.toEqual({
      raw: 3,
      daily: 2,
      active: 1,
    });
    expect(cutOf(prisma.$executeRaw)).toBe(
      new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
    );
    expect(prisma.usageDaily.deleteMany).toHaveBeenCalledWith({
      where: { day: { lt: new Date("2024-09-01T00:00:00Z") } },
    });
    expect(prisma.usageDailyActive.deleteMany).toHaveBeenCalledWith({
      where: { day: { lt: new Date("2024-09-01T00:00:00Z") } },
    });
  });

  it("without any rollup state, purges no raw event", async () => {
    const { prisma } = makePrisma(null, null);
    await expect(service(prisma).purge(NOW)).resolves.toMatchObject({ raw: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("UsageRetentionService.runPass", () => {
  it("never throws", async () => {
    const { prisma } = makePrisma(null, null);
    prisma.usageRollupState.findUnique.mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(service(prisma).runPass("cron")).resolves.toBeUndefined();
  });

  it("skips a run that overlaps a running one", async () => {
    const { prisma } = makePrisma(null, null);
    let release!: (v: null) => void;
    prisma.usageRollupState.findUnique.mockReturnValueOnce(
      new Promise((r) => (release = r)),
    );
    const s = service(prisma);
    const first = s.runPass("cron");
    await s.runPass("cron"); // returns at once
    release(null);
    await first;
    // first pass: rollup + purge = 2 reads; the overlapping pass made none
    expect(prisma.usageRollupState.findUnique).toHaveBeenCalledTimes(2);
  });
});
