import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { AdminUsageQueryService } from "./admin-usage.query-service";
import type { UsageRetentionService } from "./usage-retention.service";

const NOW = new Date("2026-10-10T10:00:00Z");
const markerOf = (sql: Prisma.Sql) =>
  /\/\* usage:(\w+) \*\//.exec(sql.sql)?.[1] ?? "";

function makePrisma(answers: Record<string, unknown[]> = {}) {
  return {
    $queryRaw: jest.fn((sql: Prisma.Sql) =>
      Promise.resolve(answers[markerOf(sql)] ?? []),
    ),
    competition: { findMany: jest.fn().mockResolvedValue([]) },
  };
}
const retention = (until: string | null) =>
  ({
    aggregatedUntil: jest.fn().mockResolvedValue(until),
  }) as unknown as UsageRetentionService;
const serviceOf = (prisma: unknown, until: string | null = null) =>
  new AdminUsageQueryService(prisma as PrismaService, retention(until));

describe("AdminUsageQueryService", () => {
  it("empty period: zero-filled days, null median, empty tables, 7×24 zero grid", async () => {
    const prisma = makePrisma({ sessions: [{ sessions: 0, median: null }] });
    const u = await serviceOf(prisma).get("30d", undefined, NOW);
    expect(u.bucket).toBe("day");
    expect(u.from).toBe("2026-09-11");
    expect(u.to).toBe("2026-10-10");
    expect(u.events).toHaveLength(30);
    expect(u.events[0]).toEqual({
      start: "2026-09-11",
      login: 0,
      login_biometric: 0,
      login_guest: 0,
      register: 0,
      license_scan: 0,
      license_wallet_add: 0,
    });
    expect(u.heatmap).toHaveLength(7);
    expect(
      u.heatmap.every((row) => row.length === 24 && row.every((c) => c === 0)),
    ).toBe(true);
    expect(u.sessions).toBe(0);
    expect(u.medianSessionMinutes).toBeNull();
    expect(u.activeInstallsPerDay).toBe(0);
    expect(u.activeInstallsThisMonth).toBe(0);
    expect(u.screens).toEqual([]);
    expect(u.competitions).toEqual([]);
    expect(prisma.competition.findMany).not.toHaveBeenCalled();
    expect(u.aggregatedUntil).toBeNull();
  });

  it("maps raw results (bigint counts) onto the response", async () => {
    const prisma = makePrisma({
      heatmap: [
        { dow: 0, hour: 9, count: BigInt(5) },
        { dow: 6, hour: 23, count: BigInt(2) },
      ],
      actives: [
        { day: "2026-10-09", installs: BigInt(6) },
        { day: "2026-10-10", installs: BigInt(3) },
      ],
      month: [{ installs: BigInt(12) }],
      sessions: [{ sessions: BigInt(4), median: 450 }],
      platforms: [
        { platform: "ios", count: BigInt(7) },
        { platform: "android", count: BigInt(3) },
      ],
      screens: [{ screen: "Home", views: BigInt(9), durationSec: BigInt(120) }],
      events: [{ start: "2026-10-10", key: "login", count: BigInt(2) }],
      versions: [{ appVersion: "1.4.2", installs: BigInt(5) }],
      competitions: [
        { competitionId: "c1", views: BigInt(3) },
        { competitionId: "c2", views: BigInt(1) },
      ],
    });
    prisma.competition.findMany.mockResolvedValue([
      { id: "c1", title: "Open de Lyon" },
    ]);
    const u = await serviceOf(prisma).get("7d", undefined, NOW);
    expect(u.heatmap[0][9]).toBe(5);
    expect(u.heatmap[6][23]).toBe(2);
    expect(u.activeInstallsPerDay).toBe(1.3); // (6 + 3) / 7 days
    expect(u.activeInstallsThisMonth).toBe(12);
    expect(u.sessions).toBe(4);
    expect(u.medianSessionMinutes).toBe(7.5);
    expect(u.platforms).toEqual({ ios: 7, android: 3 });
    expect(u.screens).toEqual([{ screen: "Home", views: 9, durationSec: 120 }]);
    expect(u.events[6].login).toBe(2);
    expect(u.versions).toEqual([{ appVersion: "1.4.2", installs: 5 }]);
    expect(u.competitions).toEqual([
      { competitionId: "c1", title: "Open de Lyon", views: 3 },
      { competitionId: "c2", title: null, views: 1 },
    ]);
    expect(prisma.competition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      select: { id: true, title: true },
      take: 2,
    });
  });

  it("12m: monthly buckets from aggregates bounded to today, no sessions", async () => {
    const prisma = makePrisma();
    const u = await serviceOf(prisma, "2026-10-09").get("12m", undefined, NOW);
    expect(u.bucket).toBe("month");
    expect(u.events).toHaveLength(12);
    expect(u.events[11].start).toBe("2026-10-01");
    expect(u.sessions).toBeNull();
    expect(u.medianSessionMinutes).toBeNull();
    expect(u.aggregatedUntil).toBe("2026-10-09");
    const sqls = prisma.$queryRaw.mock.calls.map((c) => c[0]);
    const markers = sqls.map(markerOf);
    expect(markers).toEqual(
      expect.arrayContaining([
        "heatmapAgg",
        "activesAgg",
        "screensAgg",
        "eventsAgg",
        "platformsAgg",
      ]),
    );
    expect(markers).not.toContain("sessions");
    const heatmapAgg = sqls.find((s) => markerOf(s) === "heatmapAgg");
    expect(heatmapAgg?.values).toEqual(["2025-11-01", "2026-10-10"]);
  });

  it("space filter applies to screens only", async () => {
    const prisma = makePrisma();
    await serviceOf(prisma).get("30d", "CLUB", NOW);
    const sqls = prisma.$queryRaw.mock.calls.map((c) => c[0]);
    expect(sqls.find((s) => markerOf(s) === "screens")?.values).toContain(
      "CLUB",
    );
    expect(sqls.find((s) => markerOf(s) === "heatmap")?.values).not.toContain(
      "CLUB",
    );
  });
});
