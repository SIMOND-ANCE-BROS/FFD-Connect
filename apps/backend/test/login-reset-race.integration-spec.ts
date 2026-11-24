import { randomUUID } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Prisma, UserRole } from "@prisma/client";
import { AuthPasswordService } from "../src/auth/auth-password.service";
import { AuthTokenService } from "../src/auth/auth-token.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/utils/token-hash.util";
import { buildServiceModule } from "./integration-app.builder";

/**
 * A login that verified the old password just before a password reset must
 * not keep a session after it (#886), on a real database. The race is made
 * deterministic: a third transaction holds the user row lock, the login's
 * token insert queues on it, then the reset's revocation queues too.
 */
describe("Login vs password reset race (integration, real DB, #886)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let tokens: AuthTokenService;
  let passwords: AuthPasswordService;
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule());
    tokens = module.get(AuthTokenService);
    passwords = module.get(AuthPasswordService);
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await module.close();
  });

  const newUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `login-race-${tag}-${userIds.length}@test.local`,
        password: "old-hash",
        firstName: "Race",
        lastName: "Login",
        role: UserRole.LICENSEE,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  };

  const waitForLockWaiters = async (n: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
      );
      if (Number(row.n) >= n) return;
      if (Date.now() > deadline) throw new Error(`no ${n} lock waiter(s)`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

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

  it("refuses a login whose credentials were checked before the reset, whichever gets the lock first", async () => {
    for (const loginFirst of [true, false]) {
      const userId = await newUser();
      const checkedAt = new Date();
      const { release, holder } = await holdUserLock(userId);

      const login = () =>
        tokens.createRefreshToken(userId, checkedAt).then(
          (t) => ({ ok: true as const, t }),
          (err: unknown) => ({ ok: false as const, err }),
        );
      const reset = () =>
        tokens.revokeAllUserTokens(userId, { stampTokensValidAfter: true });

      let loginResult: ReturnType<typeof login>;
      let resetResult: Promise<number>;
      if (loginFirst) {
        loginResult = login();
        await waitForLockWaiters(1);
        resetResult = reset();
      } else {
        resetResult = reset();
        await waitForLockWaiters(1);
        loginResult = login();
      }
      await waitForLockWaiters(2);
      release();
      await holder;
      const [outcome] = await Promise.all([loginResult, resetResult]);

      // Whatever the order, no live token survives the reset.
      expect(
        await prisma.refreshToken.count({ where: { userId, revoked: false } }),
      ).toBe(0);
      if (!loginFirst) {
        // The reset got the lock first: the stale login must be refused.
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.err).toBeInstanceOf(UnauthorizedException);
        }
      }
    }
  });

  it("refuses to rotate a token created before the reset (401)", async () => {
    const userId = await newUser();
    const { token } = await tokens.createRefreshToken(userId);
    // A token that escaped the revocation: live, but older than the stamp.
    await prisma.user.update({
      where: { id: userId },
      data: { tokensValidAfter: new Date(Date.now() + 1000) },
    });
    await expect(tokens.refreshAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const row = await prisma.refreshToken.findUnique({
      where: { token: hashToken(token) },
      select: { revoked: true },
    });
    expect(row?.revoked).toBe(false);
  });

  it("resetPassword stamps tokensValidAfter and a later login still works", async () => {
    const userId = await newUser();
    const { token } = await tokens.createRefreshToken(userId);
    const plainReset = randomUUID();
    await prisma.passwordResetToken.create({
      data: {
        token: hashToken(plainReset),
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await passwords.resetPassword(plainReset, "N3w-Str0ng-Passw0rd!x");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokensValidAfter: true },
    });
    expect(user?.tokensValidAfter).toBeInstanceOf(Date);
    await expect(tokens.refreshAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Credentials checked before the reset: refused; after it: accepted.
    await expect(
      tokens.createRefreshToken(userId, new Date(Date.now() - 60_000)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      tokens.createRefreshToken(userId, new Date()),
    ).resolves.toBeDefined();
  });
});
