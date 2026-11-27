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

  /**
   * Sessions waiting, directly or behind another waiter, on the locks held
   * by the backend `holderPid` — this test's sessions only, not every lock
   * wait of the database.
   */
  const lockWaiters = async (holderPid: number): Promise<number> => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`WITH RECURSIVE blocked(pid) AS (
        SELECT a.pid FROM pg_stat_activity a
        WHERE ${holderPid}::int = ANY(pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN blocked b
          ON b.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*) AS n FROM blocked`,
    );
    return Number(row.n);
  };

  const waitForLockWaiters = async (
    holderPid: number,
    n: number,
  ): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while ((await lockWaiters(holderPid)) < n) {
      if (Date.now() > deadline) {
        throw new Error(`expected ${n} session(s) waiting on a lock`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  /** Holds the row lock taken by `lockSql` until `release()` is called. */
  const holdLock = async (lockSql: Prisma.Sql) => {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: (pid: number) => void;
    const isLocked = new Promise<number>((r) => (locked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(lockSql);
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        locked(pid);
        await released;
      },
      { timeout: 20_000 },
    );
    const pid = await isLocked;
    return { release, holder, pid };
  };

  const holdUserLock = (userId: string) =>
    holdLock(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);

  const liveTokens = (userId: string) =>
    prisma.refreshToken.count({ where: { userId, revoked: false } });

  /**
   * Runs the race and checks the invariant. `first` is the one that queues
   * first on the user row lock, so it is the one PostgreSQL grants first.
   * Returns how the refresh ended: a 401 (it ran after the deactivation) or
   * tokens that the deactivation then revoked (it ran before).
   */
  const race = async (
    userId: string,
    disable: () => Promise<unknown>,
    first: "refresh" | "disable",
  ): Promise<"refused" | "revoked-after"> => {
    const { token } = await tokens.createRefreshToken(userId);
    const { release, holder, pid } = await holdUserLock(userId);

    const startRefresh = () =>
      tokens.refreshAccessToken(token).then(
        (res) => ({ ok: true as const, res }),
        (err: unknown) => ({ ok: false as const, err }),
      );
    const startDisable = () => {
      const p = disable();
      p.catch(() => undefined);
      return p;
    };
    let refresh: ReturnType<typeof startRefresh>;
    let disabling: Promise<unknown>;
    try {
      if (first === "refresh") {
        refresh = startRefresh();
        await waitForLockWaiters(pid, 1);
        disabling = startDisable();
      } else {
        disabling = startDisable();
        await waitForLockWaiters(pid, 1);
        // Its fast-path read still sees an active account: the deactivation
        // has not committed yet.
        refresh = startRefresh();
      }
      await waitForLockWaiters(pid, 2);
    } finally {
      // Never leave the lock held: the next tests would queue behind it.
      release();
    }
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

  const createClubAccount = async (label: string) => {
    const club = await prisma.club.create({
      data: { name: `Race club ${label} ${tag}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const user = await prisma.user.create({
      data: {
        email: `race-club-${label}-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "Club",
        role: UserRole.CLUB,
        clubId: club.id,
        clubName: `Race club ${label} ${tag}`,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return { clubId: club.id, userId: user.id };
  };

  const createLicensee = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `race-user-${label}-${tag}@test.local`,
        password: "x",
        firstName: "Race",
        lastName: "User",
        role: UserRole.LICENSEE,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  };

  it("revokes the token of a refresh that ran before the club's deactivation", async () => {
    const { clubId, userId } = await createClubAccount("first");
    const outcome = await race(
      userId,
      () => module.get(AdminClubsService).setStatus(adminId, clubId, false),
      "refresh",
    );
    expect(outcome).toBe("revoked-after");
  });

  it("refuses a refresh queued behind the club's deactivation", async () => {
    const { clubId, userId } = await createClubAccount("queued");
    const outcome = await race(
      userId,
      () => module.get(AdminClubsService).setStatus(adminId, clubId, false),
      "disable",
    );
    expect(outcome).toBe("refused");
  });

  it("revokes the token of a refresh that ran before the account's deactivation", async () => {
    const userId = await createLicensee("first");
    const outcome = await race(
      userId,
      () => module.get(AdminUsersService).setStatus(adminId, userId, false),
      "refresh",
    );
    expect(outcome).toBe("revoked-after");
  });

  it("refuses a refresh queued behind the account's deactivation", async () => {
    const userId = await createLicensee("queued");
    const outcome = await race(
      userId,
      () => module.get(AdminUsersService).setStatus(adminId, userId, false),
      "disable",
    );
    expect(outcome).toBe("refused");
  });

  /**
   * #900: the rename locks the club row then the club's users, so the
   * deactivation must take its locks in the same order. Made deterministic:
   * a third transaction holds the club row; the rename queues on it, then
   * the deactivation; the holder lets go. With opposite orders the
   * deactivation would hold the CLUB accounts while waiting for the club,
   * and the rename the club while waiting for the accounts: PostgreSQL
   * would abort one of them (deadlock detected).
   */
  it("renames and disables the same club concurrently without deadlock", async () => {
    const { clubId, userId } = await createClubAccount("rename");
    await tokens.createRefreshToken(userId);
    const newName = `Race club renamed ${tag}`;
    const clubs = module.get(AdminClubsService);

    const { release, holder, pid } = await holdLock(
      Prisma.sql`SELECT id FROM "Club" WHERE id = ${clubId} FOR UPDATE`,
    );
    const renaming = clubs.update(adminId, clubId, { name: newName });
    renaming.catch(() => undefined);
    let disabling: Promise<unknown>;
    try {
      await waitForLockWaiters(pid, 1);
      disabling = clubs.setStatus(adminId, clubId, false);
      disabling.catch(() => undefined);
      await waitForLockWaiters(pid, 2);
    } finally {
      release();
    }
    await holder;
    // Awaited as is: a deadlock fails the test with PostgreSQL's message.
    await renaming;
    await disabling;

    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { name: true, disabledAt: true },
    });
    expect(club.name).toBe(newName);
    expect(club.disabledAt).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { clubName: true },
    });
    expect(user.clubName).toBe(newName);
    expect(await liveTokens(userId)).toBe(0);
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
    const { release, holder, pid } = await holdUserLock(user.id);
    const refresh = tokens.refreshAccessToken(token);
    refresh.catch(() => undefined);
    await waitForLockWaiters(pid, 1);
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
