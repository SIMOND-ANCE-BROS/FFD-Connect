import { randomUUID } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Prisma, UserRole } from "@prisma/client";
import { AdminClubsService } from "../src/admin/admin-clubs.service";
import { AdminUsersService } from "../src/admin/admin-users.service";
import { ACCOUNT_DISABLED_MESSAGE } from "../src/auth/account-status";
import { AuthTokenService } from "../src/auth/auth-token.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/utils/token-hash.util";
import { buildServiceModule } from "./integration-app.builder";

/**
 * A refresh racing the deactivation of the account or of its club, on a real
 * database (#884): once the deactivation has committed, no refresh token of
 * the account is live — whichever of the two got the user row lock first.
 *
 * The race is made deterministic: a third transaction holds the user row
 * lock; the refresh starts (its fast-path read still sees an active account)
 * and queues on the lock, then the deactivation starts and queues too; the
 * holder lets go and the two run in whatever order PostgreSQL grants.
 */
describe("Refresh vs deactivation race (integration, real DB, #884)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let tokens: AuthTokenService;
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const clubIds: string[] = [];
  let adminId: string;

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule());
    tokens = module.get(AuthTokenService);
    const admin = await prisma.user.create({
      data: {
        email: `race-admin-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "Admin",
        role: UserRole.ADMIN,
      },
      select: { id: true },
    });
    adminId = admin.id;
    userIds.push(admin.id);
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { actorId: adminId },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    await module.close();
  });

  /** Sessions of this database waiting on a row lock. */
  const lockWaiters = async (): Promise<number> => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(row.n);
  };

  const waitForLockWaiters = async (n: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while ((await lockWaiters()) < n) {
      if (Date.now() > deadline) {
        throw new Error(`expected ${n} session(s) waiting on a lock`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  /** Holds the user row lock until `release()` is called. */
  const holdUserLock = async (userId: string) => {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
        );
        locked();
        await released;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    return { release, holder };
  };

  const liveTokens = (userId: string) =>
    prisma.refreshToken.count({ where: { userId, revoked: false } });

  /**
   * Runs the race and checks the invariant. Returns how the refresh ended:
   * a 401 (it ran after the deactivation) or tokens that the deactivation
   * then revoked (it ran before).
   */
  const race = async (
    userId: string,
    disable: () => Promise<unknown>,
  ): Promise<"refused" | "revoked-after"> => {
    const { token } = await tokens.createRefreshToken(userId);
    const { release, holder } = await holdUserLock(userId);

    const refresh = tokens.refreshAccessToken(token).then(
      (res) => ({ ok: true as const, res }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await waitForLockWaiters(1);
    const disabling = disable();
    await waitForLockWaiters(2);

    release();
    await holder;
    const [outcome] = await Promise.all([refresh, disabling]);

    // The invariant: after the deactivation committed, nothing is live.
    expect(await liveTokens(userId)).toBe(0);
    if (outcome.ok) {
      const issued = await prisma.refreshToken.findUnique({
        where: { token: hashToken(outcome.res.refresh_token) },
        select: { revoked: true },
      });
      expect(issued?.revoked).toBe(true);
      return "revoked-after";
    }
    expect(outcome.err).toEqual(
      new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE),
    );
    return "refused";
  };

  it("leaves no live token when the CLUB account's club is disabled during a refresh", async () => {
    const club = await prisma.club.create({
      data: { name: `Race club ${tag}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const user = await prisma.user.create({
      data: {
        email: `race-club-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "Club",
        role: UserRole.CLUB,
        clubId: club.id,
      },
      select: { id: true },
    });
    userIds.push(user.id);

    const outcome = await race(user.id, () =>
      module.get(AdminClubsService).setStatus(adminId, club.id, false),
    );
    // The deactivation queued behind the refresh on the user row lock, so
    // the refresh either saw the club disabled or had its token revoked.
    expect(["refused", "revoked-after"]).toContain(outcome);
  });

  it("leaves no live token when the account is disabled during a refresh", async () => {
    const user = await prisma.user.create({
      data: {
        email: `race-user-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "User",
        role: UserRole.LICENSEE,
      },
      select: { id: true },
    });
    userIds.push(user.id);

    const outcome = await race(user.id, () =>
      module.get(AdminUsersService).setStatus(adminId, user.id, false),
    );
    expect(["refused", "revoked-after"]).toContain(outcome);
  });

  it("refuses a refresh that waited for a committed club deactivation", async () => {
    const club = await prisma.club.create({
      data: { name: `Race club late ${tag}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const user = await prisma.user.create({
      data: {
        email: `race-club-late-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "Late",
        role: UserRole.CLUB,
        clubId: club.id,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    const { token } = await tokens.createRefreshToken(user.id);

    // The refresh passes its fast-path read, then waits on the lock while
    // the deactivation commits: it must see the club disabled.
    const { release, holder } = await holdUserLock(user.id);
    const refresh = tokens.refreshAccessToken(token);
    refresh.catch(() => undefined);
    await waitForLockWaiters(1);
    // Disable the club directly (the service would queue on the same lock):
    // committed before the refresh gets the lock.
    await prisma.club.update({
      where: { id: club.id },
      data: { disabledAt: new Date() },
      select: { id: true },
    });
    release();
    await holder;

    await expect(refresh).rejects.toEqual(
      new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE),
    );
    // The presented token was not consumed, and nothing new was issued.
    expect(await liveTokens(user.id)).toBe(1);
    expect(
      await prisma.refreshToken.count({ where: { userId: user.id } }),
    ).toBe(1);
  });
});
