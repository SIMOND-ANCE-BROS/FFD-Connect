import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { AdminUsageQueryService } from "../src/analytics/admin-usage.query-service";
import { UsageRetentionService } from "../src/analytics/usage-retention.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

const NOW = new Date("2001-07-18T10:00:00Z"); // Paris 2001-07-18 (Wednesday), summer time
const BEFORE_2002 = new Date("2002-01-01T00:00:00Z");

describe("Usage analytics (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: UsageRetentionService;
  const installA = randomUUID();
  const installB = randomUUID();

  beforeAll(async () => {
    jest
      .spyOn(UsageRetentionService.prototype, "onModuleInit")
      .mockImplementation(() => undefined);
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(UsageRetentionService);
  });

  const reset = async () => {
    await prisma.usageEvent.deleteMany({
      where: { installId: { in: [installA, installB] } },
    });
    await prisma.usageDaily.deleteMany({ where: { day: { lt: BEFORE_2002 } } });
    await prisma.usageDailyActive.deleteMany({
      where: { day: { lt: BEFORE_2002 } },
    });
    await prisma.usageRollupState.deleteMany({});
  };
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await moduleRef.close();
  });

  const ev = (
    installId: string,
    occurredAt: string,
    o: Record<string, unknown> = {},
  ) =>
    prisma.usageEvent.create({
      data: {
        installId,
        name: "screen_view",
        screen: "Home",
        occurredAt: new Date(occurredAt),
        platform: "ios",
        appVersion: "1.0.0",
        space: "LICENSEE",
        durationSec: 10,
        ...o,
      },
    });
  const state = (lastDay: string) =>
    prisma.usageRollupState.create({
      data: { id: 1, lastDay: new Date(`${lastDay}T00:00:00Z`) },
    });

  it("23:30 UTC lands in the next Paris day; re-running a day does not double", async () => {
    await state("2001-07-15");
    await ev(installA, "2001-07-16T23:30:00Z"); // Paris 2001-07-17 01:30
    await ev(installA, "2001-07-16T21:30:00Z"); // Paris 2001-07-16 23:30
    await ev(installB, "2001-07-16T21:45:00Z", { platform: "android" });
    expect(await service.rollup(NOW)).toEqual([
      "2001-07-11",
      "2001-07-12",
      "2001-07-13",
      "2001-07-14",
      "2001-07-15",
      "2001-07-16",
      "2001-07-17",
    ]);
    await prisma.usageRollupState.update({
      where: { id: 1 },
      data: { lastDay: new Date("2001-07-15T00:00:00Z") },
    });
    await service.rollup(NOW); // same days again

    const daily = await prisma.usageDaily.findMany({
      where: { day: { lt: BEFORE_2002 } },
      orderBy: [{ day: "asc" }, { hour: "asc" }, { platform: "asc" }],
      take: 10,
    });
    expect(
      daily.map((d) => [
        d.day.toISOString().slice(0, 10),
        d.hour,
        d.platform,
        d.count,
        d.durationSec,
      ]),
    ).toEqual([
      ["2001-07-16", 23, "android", 1, 10],
      ["2001-07-16", 23, "ios", 1, 10],
      ["2001-07-17", 1, "ios", 1, 10],
    ]);
    const active = await prisma.usageDailyActive.findMany({
      where: { day: { lt: BEFORE_2002 } },
      orderBy: [{ day: "asc" }, { platform: "asc" }],
      take: 10,
    });
    expect(
      active.map((a) => [
        a.day.toISOString().slice(0, 10),
        a.platform,
        a.installs,
      ]),
    ).toEqual([
      ["2001-07-16", "android", 1],
      ["2001-07-16", "ios", 1],
      ["2001-07-17", "ios", 1],
    ]);
  });

  it("distinct installs: two events of one install count once", async () => {
    await state("2001-07-16");
    await ev(installA, "2001-07-17T08:00:00Z");
    await ev(installA, "2001-07-17T09:00:00Z");
    await service.rollup(NOW);
    const active = await prisma.usageDailyActive.findUnique({
      where: {
        day_platform: {
          day: new Date("2001-07-17T00:00:00Z"),
          platform: "ios",
        },
      },
    });
    expect(active?.installs).toBe(1);
  });

  it("7d read: Paris heatmap, sessions split at 30 minutes, median", async () => {
    const usage = moduleRef.get(AdminUsageQueryService);
    await ev(installA, "2001-07-16T06:00:00Z"); // Mon 08:00 Paris
    await ev(installA, "2001-07-16T06:10:00Z"); // same session (10 min)
    await ev(installA, "2001-07-16T07:00:00Z"); // 50-min gap → new session (Mon 09:00)
    await ev(installB, "2001-07-15T22:30:00Z"); // Sunday UTC = Mon 00:30 Paris
    const u = await usage.get("7d", undefined, NOW);
    expect(u.heatmap[0][8]).toBe(2);
    expect(u.heatmap[0][9]).toBe(1);
    expect(u.heatmap[0][0]).toBe(1);
    expect(u.sessions).toBe(3); // A: 2, B: 1
    expect(u.medianSessionMinutes).toBe(0); // durations 10, 0, 0 min
    expect(u.screens).toEqual([{ screen: "Home", views: 4, durationSec: 40 }]);
    expect(u.activeInstallsThisMonth).toBe(2);
  });

  it("12m read comes from the aggregates", async () => {
    const usage = moduleRef.get(AdminUsageQueryService);
    await state("2001-07-15");
    await ev(installA, "2001-07-16T06:00:00Z");
    await ev(installB, "2001-07-16T06:30:00Z", { platform: "android" });
    await service.rollup(NOW);
    const u = await usage.get("12m", undefined, NOW);
    expect(u.aggregatedUntil).toBe("2001-07-17");
    expect(u.heatmap[0][8]).toBe(2);
    expect(u.platforms).toEqual({ ios: 1, android: 1 });
    expect(u.screens[0]).toEqual({ screen: "Home", views: 2, durationSec: 20 });
  });
});
