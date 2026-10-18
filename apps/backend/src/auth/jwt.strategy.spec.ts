import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import {
  accountStatusSelect,
  impersonationLogSessionSelect,
} from "../utils/prisma-selects";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  let prisma: MockPrismaService;
  let strategy: JwtStrategy;
  const payload = {
    sub: "user-1",
    email: "test@example.com",
    role: "LICENSEE",
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    const configService = {
      getOrThrow: jest
        .fn()
        .mockReturnValue("test-secret-32-chars-minimum!!!!!"),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(
      configService,
      prisma as unknown as PrismaService,
    );
  });

  it("maps the payload of an active account, after one status lookup", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: "user-1",
      email: "test@example.com",
      role: "LICENSEE",
      roles: [UserRole.LICENSEE],
      storeReview: false,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: accountStatusSelect,
    });
    expect(prisma.impersonationLog.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a disabled account with 401", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: new Date(),
      club: null,
    } as never);
    await expect(strategy.validate(payload)).rejects.toThrow(
      new UnauthorizedException("Compte désactivé. Contactez la fédération."),
    );
  });

  it("rejects a CLUB account whose club is disabled", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.CLUB,
      disabledAt: null,
      club: { disabledAt: new Date() },
    } as never);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a token whose account no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("returns the database role, not the stale token claim", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ ...payload, role: "ADMIN" }),
    ).resolves.toMatchObject({ role: UserRole.LICENSEE });
  });

  it("flags the store-review account from the same status lookup", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.ADMIN,
      extraRoles: [UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF],
      disabledAt: null,
      isStoreReview: true,
      club: { disabledAt: null },
    } as never);
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      storeReview: true,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns every effective role from the database", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      role: UserRole.ADMIN,
      extraRoles: [UserRole.LICENSEE],
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ sub: "u1", email: "a@x.fr", role: "ADMIN" }),
    ).resolves.toMatchObject({
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN, UserRole.LICENSEE],
    });
  });

  describe("impersonation (ADMIN-only, #733)", () => {
    const imp = {
      ...payload,
      impersonatedBy: "admin-1",
      impersonationLogId: "log-1",
    };
    const activeAdmin = { role: UserRole.ADMIN, disabledAt: null, club: null };
    const openSession = {
      actorId: "admin-1",
      targetUserId: "user-1",
      startedAt: new Date(Date.now() - 60_000),
      endedAt: null,
    };
    const mockLookups = (
      impersonator: unknown,
      target: unknown = {
        role: UserRole.LICENSEE,
        disabledAt: null,
        club: null,
      },
      session: unknown = openSession,
    ) => {
      prisma.user.findUnique.mockImplementation((async (args: {
        where: { id: string };
      }) => (args.where.id === "user-1" ? target : impersonator)) as never);
      prisma.impersonationLog.findUnique.mockResolvedValue(session as never);
    };

    it("accepts an active ADMIN impersonator on an open session", async () => {
      mockLookups(activeAdmin);
      await expect(strategy.validate(imp)).resolves.toEqual({
        userId: "user-1",
        email: "test@example.com",
        role: UserRole.LICENSEE,
        roles: [UserRole.LICENSEE],
        impersonatedBy: "admin-1",
        impersonationLogId: "log-1",
        storeReview: false,
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        select: accountStatusSelect,
      });
      expect(prisma.impersonationLog.findUnique).toHaveBeenCalledWith({
        where: { id: "log-1" },
        select: impersonationLogSessionSelect,
      });
    });

    it("accepts a STAFF target (only ADMIN targets are refused)", async () => {
      mockLookups(activeAdmin, {
        role: UserRole.STAFF,
        disabledAt: null,
        club: null,
      });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        role: UserRole.STAFF,
        impersonatedBy: "admin-1",
      });
    });

    it("accepts an impersonator whose ADMIN role is an extra role", async () => {
      mockLookups({
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.ADMIN],
        disabledAt: null,
        club: null,
      });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        userId: "user-1",
        impersonatedBy: "admin-1",
      });
    });

    it("keeps writes simulated in an impersonation opened by the store-review account", async () => {
      mockLookups({ ...activeAdmin, isStoreReview: true });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        userId: "user-1",
        impersonatedBy: "admin-1",
        storeReview: true,
      });
    });

    it.each([
      ["disabled", { ...activeAdmin, disabledAt: new Date() }],
      ["demoted to LICENSEE", { ...activeAdmin, role: UserRole.LICENSEE }],
      // STAFF lost support access with #733: a session dies with the demotion.
      ["demoted to STAFF", { ...activeAdmin, role: UserRole.STAFF }],
      [
        "STAFF with no ADMIN role at all",
        { ...activeAdmin, role: UserRole.CLUB, extraRoles: [UserRole.STAFF] },
      ],
      ["missing", null],
    ])("rejects an impersonator who is %s", async (_label, impersonator) => {
      mockLookups(impersonator);
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each([
      ["main", { role: UserRole.ADMIN, extraRoles: [] }],
      ["extra", { role: UserRole.LICENSEE, extraRoles: [UserRole.ADMIN] }],
    ])(
      "rejects the session once the target holds ADMIN (%s role)",
      async (_label, roles) => {
        mockLookups(activeAdmin, { ...roles, disabledAt: null, club: null });
        await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(prisma.impersonationLog.findUnique).not.toHaveBeenCalled();
      },
    );

    it("rejects an impersonation token that names no journal row", async () => {
      mockLookups(activeAdmin);
      await expect(
        strategy.validate({ ...payload, impersonatedBy: "admin-1" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.impersonationLog.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ["stopped", { ...openSession, endedAt: new Date() }],
      ["purged", null],
      ["of another actor", { ...openSession, actorId: "admin-2" }],
      ["on another target", { ...openSession, targetUserId: "user-2" }],
      [
        "older than 15 minutes (#762)",
        { ...openSession, startedAt: new Date(Date.now() - 15 * 60_000 - 1) },
      ],
    ])("rejects the token once its session is %s", async (_label, session) => {
      mockLookups(activeAdmin, undefined, session);
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("still accepts a session just under its 15 minutes (#762)", async () => {
      mockLookups(activeAdmin, undefined, {
        ...openSession,
        startedAt: new Date(Date.now() - 14 * 60_000),
      });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        impersonatedBy: "admin-1",
      });
    });
  });
});
