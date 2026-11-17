/**
 * Inactive-account purge selection (#991) against a real Postgres: the
 * last-login / createdAt fallback and the column-to-column comparison of the
 * warning date with the last login run for real.
 */
import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../src/prisma/prisma.service";
import { InactiveAccountPurgeService } from "../src/users/inactive-account-purge.service";
import { InactiveAccountsQueryService } from "../src/users/inactive-accounts.query-service";
import { idOnlySelect } from "../src/utils/prisma-selects";
import { buildServiceModule } from "./integration-app.builder";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
/** 3 years ≈ 1096 days; the margins below keep clear of the boundary. */
const YEARS_3 = 1096;

describe("Inactive-account purge selection (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let query: InactiveAccountsQueryService;
  let purge: InactiveAccountPurgeService;
  const tag = `inactive-${randomUUID()}`;
  const ids: string[] = [];
  const licences: string[] = [];

  const user = async (data: {
    createdAt: Date;
    lastLoginAt?: Date | null;
    inactivityWarningSentAt?: Date | null;
    isStoreReview?: boolean;
  }): Promise<string> => {
    const { id } = await prisma.user.create({
      data: {
        email: `${tag}-${ids.length}@example.test`,
        password: "x",
        firstName: "Test",
        lastName: "Inactive",
        ...data,
      },
      select: idOnlySelect,
    });
    ids.push(id);
    return id;
  };

  /** Every warning candidate (pages until exhausted; the DB is shared). */
  const allWarningDue = async (): Promise<string[]> => {
    const found: string[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const rows = await query.findWarningDue(NOW, afterId, 100);
      found.push(...rows.map((r) => r.id));
      if (rows.length < 100) break;
      afterId = rows[rows.length - 1].id;
    }
    return found;
  };

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    query = moduleRef.get(InactiveAccountsQueryService);
    purge = moduleRef.get(InactiveAccountPurgeService);
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { number: { in: licences } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await moduleRef.close();
  });

  it("selects for a warning only accounts close to 3 years without login", async () => {
    const recent = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(10),
    });
    const nearlyDue = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 - 20),
    });
    const neverLoggedOld = await user({
      createdAt: daysAgo(YEARS_3 - 10),
      lastLoginAt: null,
    });
    const neverLoggedNew = await user({ createdAt: daysAgo(30) });
    const storeReview = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(2000),
      isStoreReview: true,
    });
    const alreadyWarned = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 - 20),
      inactivityWarningSentAt: daysAgo(5),
    });
    const warnedBeforeLastLogin = await user({
      createdAt: daysAgo(4000),
      lastLoginAt: daysAgo(YEARS_3 - 20),
      inactivityWarningSentAt: daysAgo(2500),
    });

    const due = await allWarningDue();

    expect(due).toEqual(
      expect.arrayContaining([
        nearlyDue,
        neverLoggedOld,
        warnedBeforeLastLogin,
      ]),
    );
    expect(due).not.toContain(recent);
    expect(due).not.toContain(neverLoggedNew);
    expect(due).not.toContain(storeReview);
    expect(due).not.toContain(alreadyWarned);
  });

  it("deletes only accounts inactive for 3 years AND warned 30+ days ago since the last login", async () => {
    const due = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(40),
    });
    const neverLoggedDue = await user({
      createdAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(40),
    });
    const notWarned = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
    });
    const warnedTooRecently = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(10),
    });
    const loggedInAfterWarning = await user({
      createdAt: daysAgo(3000),
      lastLoginAt: daysAgo(30),
      inactivityWarningSentAt: daysAgo(60),
    });
    const staleWarning = await user({
      createdAt: daysAgo(5000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(3000),
    });
    const storeReview = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(40),
      isStoreReview: true,
    });

    await expect(query.isDeletionDue(due, NOW)).resolves.toBe(true);
    await expect(query.isDeletionDue(neverLoggedDue, NOW)).resolves.toBe(true);
    await expect(query.isDeletionDue(notWarned, NOW)).resolves.toBe(false);
    await expect(query.isDeletionDue(warnedTooRecently, NOW)).resolves.toBe(
      false,
    );
    await expect(query.isDeletionDue(loggedInAfterWarning, NOW)).resolves.toBe(
      false,
    );
    await expect(query.isDeletionDue(staleWarning, NOW)).resolves.toBe(false);
    await expect(query.isDeletionDue(storeReview, NOW)).resolves.toBe(false);

    const counts = await query.countDue(NOW);
    expect(counts.deletion).toBeGreaterThanOrEqual(2);
  });

  it("deletes through the shared chain: the licence is released (#897)", async () => {
    const id = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
      inactivityWarningSentAt: daysAgo(40),
    });
    const kept = await user({
      createdAt: daysAgo(2000),
      lastLoginAt: daysAgo(YEARS_3 + 10),
    });
    const number = `INACT-${randomUUID().slice(0, 8)}`;
    licences.push(number);
    await prisma.license.create({
      data: {
        number,
        validUntil: new Date("2030-08-31"),
        category: "Latin",
        clubName: "Club test",
        userId: id,
      },
      select: idOnlySelect,
    });

    const result = await purge.deleteDueAccounts(NOW);

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.user.findUnique({ where: { id }, select: idOnlySelect }),
    ).resolves.toBeNull();
    // Never warned: kept.
    await expect(
      prisma.user.findUnique({ where: { id: kept }, select: idOnlySelect }),
    ).resolves.toEqual({ id: kept });
    const licence = await prisma.license.findUnique({
      where: { number },
      select: { userId: true, releasedAt: true },
    });
    expect(licence?.userId).toBeNull();
    expect(licence?.releasedAt).toBeInstanceOf(Date);
  });
});
