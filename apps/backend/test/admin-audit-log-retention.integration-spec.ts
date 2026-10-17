/**
 * Back-office audit trail retention (#741) against a real Postgres: the
 * `createdAt` bound and the batched delete run for real.
 */
import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { AdminAuditLogRetentionService } from "../src/admin/admin-audit-log-retention.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { idOnlySelect } from "../src/utils/prisma-selects";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe("Admin audit log retention (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let retention: AdminAuditLogRetentionService;
  /** Rows of this suite only: the database is shared with other suites. */
  const targetType = `RETENTION_TEST_${randomUUID()}`;

  const row = (createdAt: Date) =>
    prisma.adminAuditLog.create({
      data: {
        action: "USER_UPDATE",
        targetType,
        targetId: randomUUID(),
        before: { firstName: "Avant" },
        after: { firstName: "Après" },
        createdAt,
      },
      select: idOnlySelect,
    });

  const remaining = async () =>
    (
      await prisma.adminAuditLog.findMany({
        where: { targetType },
        select: idOnlySelect,
        take: 10,
      })
    ).map((entry) => entry.id);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [PrismaService, AdminAuditLogRetentionService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    retention = moduleRef.get(AdminAuditLogRetentionService);
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { targetType } });
    await moduleRef.close();
  });

  it("deletes the rows older than 365 days and keeps the others", async () => {
    expect(retention.retentionDays).toBe(365);
    const expired = await row(daysAgo(366));
    const veryOld = await row(daysAgo(900));
    const recent = await row(daysAgo(364));
    const fresh = await row(NOW);

    const deleted = await retention.purge(NOW);

    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = await remaining();
    expect(left).toEqual(expect.arrayContaining([recent.id, fresh.id]));
    expect(left).not.toContain(expired.id);
    expect(left).not.toContain(veryOld.id);
  });

  it("is a no-op on a second pass", async () => {
    await expect(retention.purge(NOW)).resolves.toBe(0);
    expect(await remaining()).toHaveLength(2);
  });
});
