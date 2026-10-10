import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { statsWindow } from "./stats-period";
import { medianReviewHours, timeSeries } from "./stats-series";

const w = statsWindow("12w", new Date("2026-07-15T10:00:00Z"));

const prismaWith = (rows: unknown) => {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  return { prisma: { $queryRaw } as unknown as PrismaService, $queryRaw };
};
const sqlOf = (mock: jest.Mock) => mock.mock.calls[0][0] as Prisma.Sql;

describe("timeSeries", () => {
  it("converts bigint counts to numbers", async () => {
    const { prisma } = prismaWith([
      { start: "2026-07-13", key: "CLUB", count: BigInt(3) },
    ]);
    const rows = await timeSeries(prisma, "signups", w);
    expect(rows).toEqual([{ start: "2026-07-13", key: "CLUB", count: 3 }]);
    expect(() => JSON.stringify(rows)).not.toThrow();
  });

  it("signups: User table, split by role, store-review excluded, Paris week", async () => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(prisma, "signups", w);
    const sql = sqlOf($queryRaw);
    expect(sql.sql).toContain('FROM "User"');
    expect(sql.sql).toContain('"role"::text');
    expect(sql.sql).toContain('"isStoreReview" = false');
    expect(sql.sql).toContain("AT TIME ZONE 'Europe/Paris'");
    expect(sql.values).toEqual([
      "week",
      w.start.toISOString(),
      w.end.toISOString(),
    ]);
  });

  it("monthly unit is a bound value", async () => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(
      prisma,
      "bugReports",
      statsWindow("6m", new Date("2026-07-15T10:00:00Z")),
    );
    const sql = sqlOf($queryRaw);
    expect(sql.sql).toContain('FROM "BugReport"');
    expect(sql.sql).toContain("NULL::text");
    expect(sql.values[0]).toBe("month");
  });

  it.each([
    ["licences", '"License"', "NULL::text"],
    ["registrations", '"Registration"', '"status"::text'],
    ["corrections", '"TrackCorrection"', '"reason"::text'],
    ["adminActions", '"AdminAuditLog"', "NULL::text"],
  ] as const)("%s reads %s split by %s", async (key, table, split) => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(prisma, key, w);
    expect(sqlOf($queryRaw).sql).toContain(`FROM ${table}`);
    expect(sqlOf($queryRaw).sql).toContain(split);
  });
});

describe("medianReviewHours", () => {
  it("returns hours with one decimal", async () => {
    const { prisma } = prismaWith([{ median: 5400 }]); // seconds
    await expect(medianReviewHours(prisma, w)).resolves.toBe(1.5);
  });

  it("returns null without decided corrections", async () => {
    const { prisma } = prismaWith([{ median: null }]);
    await expect(medianReviewHours(prisma, w)).resolves.toBeNull();
  });
});
