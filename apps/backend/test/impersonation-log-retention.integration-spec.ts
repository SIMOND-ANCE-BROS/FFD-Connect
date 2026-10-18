/**
 * Support-access journal retention (#731) against a real Postgres.
 *
 * The unit suite asserts the queries against a mocked Prisma; here they run
 * for real: the `startedAt` bounds, the "full IP" filter (`NOT contains '/'`
 * on a nullable column), the batched delete and the IP truncation.
 */
import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { ImpersonationLogRetentionService } from "../src/auth/impersonation-log-retention.service";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  idOnlySelect,
  impersonationLogIpSelect,
} from "../src/utils/prisma-selects";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe("Impersonation log retention (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let retention: ImpersonationLogRetentionService;
  /** Rows of this suite only: the database is shared with other suites. */
  const actorId = randomUUID();

  const row = (startedAt: Date, ip: string | null) =>
    prisma.impersonationLog.create({
      data: {
        actorId,
        actorRole: UserRole.STAFF,
        targetUserId: randomUUID(),
        targetRole: UserRole.LICENSEE,
        reason: "Ticket support",
        ip,
        startedAt,
        endedAt: startedAt,
      },
      select: idOnlySelect,
    });

  const ipOf = async (id: string) =>
    (
      await prisma.impersonationLog.findUnique({
        where: { id },
        select: impersonationLogIpSelect,
      })
    )?.ip;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [PrismaService, ImpersonationLogRetentionService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    retention = moduleRef.get(ImpersonationLogRetentionService);
  });

  afterEach(async () => {
    await prisma.impersonationLog.deleteMany({ where: { actorId } });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("deletes rows older than 365 days and keeps the others", async () => {
    const old = await row(daysAgo(400), null);
    const edge = await row(daysAgo(364), null);
    const fresh = await row(daysAgo(1), null);

    const report = await retention.purge(NOW);

    expect(report.deleted).toBeGreaterThanOrEqual(1);
    const left = await prisma.impersonationLog.findMany({
      where: { actorId },
      select: idOnlySelect,
      take: 10,
    });
    expect(left.map((r) => r.id).sort()).toEqual([edge.id, fresh.id].sort());
    expect(left.map((r) => r.id)).not.toContain(old.id);
  });

  it("purges the writes journalled during a session with it (#761)", async () => {
    const old = await row(daysAgo(400), null);
    const fresh = await row(daysAgo(1), null);
    const action = (impersonationLogId: string) =>
      prisma.impersonationActionLog.create({
        data: {
          impersonationLogId,
          method: "PATCH",
          route: "/clubs/me/registration-mode",
          statusCode: 403,
        },
        select: idOnlySelect,
      });
    const oldAction = await action(old.id);
    const freshAction = await action(fresh.id);

    await retention.purge(NOW);

    // Same pass, same deadline: ON DELETE CASCADE from the session row.
    const left = await prisma.impersonationActionLog.findMany({
      where: { id: { in: [oldAction.id, freshAction.id] } },
      select: idOnlySelect,
      take: 10,
    });
    expect(left).toEqual([{ id: freshAction.id }]);
  });

  it("reduces the full IP of rows older than 90 days to its network, once", async () => {
    const v4 = await row(daysAgo(100), "203.0.113.42");
    const v6 = await row(daysAgo(200), "2001:db8:abcd:12::1");
    const recent = await row(daysAgo(10), "198.51.100.7");
    const noIp = await row(daysAgo(100), null);
    const already = await row(daysAgo(100), "192.0.2.0/24");

    await retention.purge(NOW);

    expect(await ipOf(v4.id)).toBe("203.0.113.0/24");
    expect(await ipOf(v6.id)).toBe("2001:db8:abcd::/48");
    expect(await ipOf(recent.id)).toBe("198.51.100.7");
    expect(await ipOf(noIp.id)).toBeNull();
    expect(await ipOf(already.id)).toBe("192.0.2.0/24");

    // Nothing of this suite is left to truncate: a second pass is a no-op.
    const fullLeft = await prisma.impersonationLog.count({
      where: {
        actorId,
        startedAt: { lt: daysAgo(90) },
        ip: { not: null },
        NOT: [{ ip: { contains: "/" } }, { ip: "unknown" }],
      },
    });
    expect(fullLeft).toBe(0);
  });
});
