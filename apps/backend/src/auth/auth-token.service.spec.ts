import { Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthTokenService, REFRESH_REUSE_GRACE_MS } from "./auth-token.service";

/** Mirror the hash logic from the service for test assertions */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("AuthTokenService", () => {
  let service: AuthTokenService;
  let module: TestingModule;

  const mockPrismaService = {
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  /** SQL text of a Prisma.sql template passed to $queryRaw. */
  const rawSql = (call: unknown[]): string =>
    (call[0] as { strings: string[] }).strings.join("?");
  const rawValues = (call: unknown[]): unknown[] =>
    (call[0] as { values: unknown[] }).values;

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthTokenService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthTokenService>(AuthTokenService);
    jest.clearAllMocks();
    // Interactive transaction: run the callback against the same mock.
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        cb(mockPrismaService),
    );
    mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    // Status re-read under the user lock (#884): active by default.
    mockPrismaService.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      extraRoles: [],
      disabledAt: null,
      isStoreReview: false,
      club: null,
    });
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createRefreshToken", () => {
    it("should store a SHA-256 hash and return the plain token", async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockImplementation(
        ({ data }: { data: { token: string } }) =>
          Promise.resolve({ id: "rt-1", ...data }),
      );

      const result = await service.createRefreshToken("u1");

      // The returned token should be a 128-char hex string (64 random bytes)
      expect(result.token).toHaveLength(128);
      // The value stored in DB should be the SHA-256 hash, not the plain token
      const storedHash =
        mockPrismaService.refreshToken.create.mock.calls[0][0].data.token;
      expect(storedHash).toBe(hashToken(result.token));
      expect(storedHash).not.toBe(result.token);
    });

    it("starts a new family rooted at the token itself (#687)", async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockImplementation(
        ({ data }: { data: { token: string } }) => Promise.resolve(data),
      );

      await service.createRefreshToken("u1");

      const { data } = mockPrismaService.refreshToken.create.mock
        .calls[0][0] as { data: { id: string; familyId: string } };
      expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(data.familyId).toBe(data.id);
    });

    it("gives each login its own family", async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockImplementation(
        ({ data }: { data: { token: string } }) => Promise.resolve(data),
      );

      await service.createRefreshToken("u1");
      await service.createRefreshToken("u1");

      const families = mockPrismaService.refreshToken.create.mock.calls.map(
        (c) => (c[0] as { data: { familyId: string } }).data.familyId,
      );
      expect(families[0]).not.toBe(families[1]);
    });
  });

  describe("refreshAccessToken", () => {
    it("should return new tokens when refresh token is valid", async () => {
      const plainToken = "old-refresh-plain";
      const futureDate = new Date(Date.now() + 86400000);
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "tok-1",
        token: hashToken(plainToken),
        revoked: false,
        expiresAt: futureDate,
        user: {
          id: "u1",
          email: "u@test.com",
          firstName: "First",
          lastName: "Last",
          role: UserRole.LICENSEE,
          clubName: "Club",
          license: { number: "L1" },
        },
      });
      mockJwtService.sign.mockReturnValue("new-access");

      const result = await service.refreshAccessToken(plainToken);

      // Should lookup by hash
      expect(mockPrismaService.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: hashToken(plainToken) },
        }),
      );
      expect(result.access_token).toBe("new-access");
      // The new refresh token should be a plain token (not a hash)
      expect(result.refresh_token).toHaveLength(128);
      expect(result.user).toEqual(
        expect.objectContaining({
          id: "u1",
          email: "u@test.com",
          licenseNumber: "L1",
        }),
      );
    });

    it("returns the main role and every role on refresh", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "tok-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: "u1",
          email: "u@test.com",
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: { disabledAt: null },
        },
      });
      mockJwtService.sign.mockReturnValue("new-access");

      const result = await service.refreshAccessToken("old-refresh-plain");

      expect(result.user.role).toBe(UserRole.LICENSEE);
      expect(result.user.roles).toEqual([UserRole.LICENSEE, UserRole.CLUB]);
    });

    it("records lastLoginAt in the rotation transaction", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "tok-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "u1", email: "u@test.com", role: UserRole.CLUB },
      });
      mockJwtService.sign.mockReturnValue("new-access");

      await service.refreshAccessToken("old-refresh-plain");

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { lastLoginAt: expect.any(Date) as unknown },
        select: { id: true },
      });
    });

    describe("atomic consumption (#681)", () => {
      const validRecord = () => ({
        id: "tok-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "u1", email: "u@test.com", role: UserRole.LICENSEE },
      });

      it("consumes the token with a conditional update on revoked=false and not expired", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          validRecord(),
        );
        mockJwtService.sign.mockReturnValue("new-access");

        await service.refreshAccessToken("plain");

        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
          where: {
            id: "tok-1",
            revoked: false,
            expiresAt: { gt: expect.any(Date) as unknown },
          },
          data: {
            revoked: true,
            revokedAt: expect.any(Date) as unknown,
          },
        });
        expect(mockPrismaService.refreshToken.update).not.toHaveBeenCalled();
        const created = mockPrismaService.refreshToken.create.mock
          .calls[0][0] as { data: { token: string; userId: string } };
        expect(created.data.userId).toBe("u1");
      });

      it("returns 401 and issues nothing when a concurrent refresh consumed the token first", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          validRecord(),
        );
        mockPrismaService.refreshToken.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(service.refreshAccessToken("plain")).rejects.toThrow(
          new UnauthorizedException("Invalid or expired refresh token"),
        );
        expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
        expect(mockPrismaService.user.update).not.toHaveBeenCalled();
        expect(mockJwtService.sign).not.toHaveBeenCalled();
      });

      it("does not revoke the user's other sessions when it loses the race", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          validRecord(),
        );
        mockPrismaService.refreshToken.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(service.refreshAccessToken("plain")).rejects.toThrow();
        // Only the single conditional consume ran — no userId-wide revocation.
        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledTimes(
          1,
        );
        expect(
          mockPrismaService.refreshToken.updateMany.mock.calls[0][0],
        ).toEqual(
          expect.objectContaining({
            where: expect.objectContaining({ id: "tok-1" }) as unknown,
          }),
        );
      });

      it("rejects an expired token without touching the database", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue({
          ...validRecord(),
          expiresAt: new Date(Date.now() - 1000),
        });

        await expect(service.refreshAccessToken("plain")).rejects.toThrow(
          "Invalid or expired refresh token",
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });
    });

    it("does not record lastLoginAt when the refresh token is rejected", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshAccessToken("bad")).rejects.toThrow();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it("should throw when refresh token is invalid", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshAccessToken("invalid-token")).rejects.toThrow(
        "Invalid or expired refresh token",
      );
    });

    it("should throw when refresh token is revoked", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "t1",
        userId: "u1",
        familyId: "fam-1",
        revoked: true,
        revokedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 86400000),
      });
      await expect(service.refreshAccessToken("revoked-token")).rejects.toThrow(
        new UnauthorizedException("Invalid or expired refresh token"),
      );
      expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    describe("token families and reuse detection (#687)", () => {
      const familyRecord = (overrides: Record<string, unknown> = {}) => ({
        id: "tok-2",
        userId: "u1",
        familyId: "fam-1",
        revoked: false,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "u1", email: "u@test.com", role: UserRole.LICENSEE },
        ...overrides,
      });

      beforeEach(() => {
        mockJwtService.sign.mockReturnValue("new-access");
      });

      afterEach(() => {
        // Logger.prototype.warn spies must not leak into other suites' tests.
        jest.restoreAllMocks();
      });

      it("keeps the rotated token in its parent's family", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord(),
        );

        const result = await service.refreshAccessToken("plain");

        expect(result.refresh_token).toHaveLength(128);
        const { data } = mockPrismaService.refreshToken.create.mock
          .calls[0][0] as { data: { familyId: string; token: string } };
        expect(data.familyId).toBe("fam-1");
        // Still stored hashed.
        expect(data.token).toBe(hashToken(result.refresh_token));
      });

      it("roots a legacy token's chain at the legacy token id", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({ id: "legacy-1", familyId: null }),
        );

        await service.refreshAccessToken("plain");

        const { data } = mockPrismaService.refreshToken.create.mock
          .calls[0][0] as { data: { familyId: string } };
        expect(data.familyId).toBe("legacy-1");
      });

      it("locks the user row before consuming the token", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord(),
        );

        await service.refreshAccessToken("plain");

        expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
        const call = mockPrismaService.$queryRaw.mock.calls[0] as unknown[];
        expect(rawSql(call)).toContain('FROM "User"');
        expect(rawSql(call)).toContain("FOR UPDATE");
        expect(rawValues(call)).toEqual(["u1"]);
        expect(
          mockPrismaService.$queryRaw.mock.invocationCallOrder[0],
        ).toBeLessThan(
          mockPrismaService.refreshToken.updateMany.mock.invocationCallOrder[0],
        );
      });

      it("revokes the whole family when a rotated token is reused after the grace window", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({
            id: "tok-1",
            revoked: true,
            revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000),
          }),
        );
        const warn = jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        await expect(service.refreshAccessToken("stolen")).rejects.toThrow(
          new UnauthorizedException("Invalid or expired refresh token"),
        );

        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledTimes(
          1,
        );
        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
          where: {
            userId: "u1",
            revoked: false,
            OR: [{ familyId: "fam-1" }, { id: "fam-1" }],
          },
          data: { revoked: true, revokedAt: expect.any(Date) as unknown },
        });
        // Under the user lock, and nothing is issued.
        expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
        expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
        expect(mockPrismaService.user.update).not.toHaveBeenCalled();
        expect(mockJwtService.sign).not.toHaveBeenCalled();
        // Logged with ids only — never the token.
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("family fam-1"),
        );
        expect(warn.mock.calls[0][0]).not.toContain("stolen");
        warn.mockRestore();
      });

      it("never revokes other families: the revocation is scoped to the family", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({ revoked: true, revokedAt: new Date(0) }),
        );
        jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        await expect(service.refreshAccessToken("old")).rejects.toThrow();

        const { where } = mockPrismaService.refreshToken.updateMany.mock
          .calls[0][0] as { where: Record<string, unknown> };
        // Not a user-wide revocation: the family filter is always present.
        expect(where.OR).toEqual([{ familyId: "fam-1" }, { id: "fam-1" }]);
      });

      it("revokes a legacy token's descendants on reuse (family = legacy id)", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({
            id: "legacy-1",
            familyId: null,
            revoked: true,
            revokedAt: new Date(Date.now() - 3_600_000),
          }),
        );
        jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        await expect(service.refreshAccessToken("old")).rejects.toThrow();

        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: [{ familyId: "legacy-1" }, { id: "legacy-1" }],
            }) as unknown,
          }),
        );
      });

      it("treats a revoked token without revokedAt as outside the grace window", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({ revoked: true, revokedAt: null }),
        );
        jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        await expect(service.refreshAccessToken("old")).rejects.toThrow();

        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledTimes(
          1,
        );
      });

      it("revokes the family even when the reused token has expired", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({
            revoked: true,
            revokedAt: new Date(Date.now() - 86_400_000),
            expiresAt: new Date(Date.now() - 1000),
          }),
        );
        jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        await expect(service.refreshAccessToken("old")).rejects.toThrow();

        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledTimes(
          1,
        );
      });

      it("only refuses a token rotated within the grace window (legitimate late racer)", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({
            revoked: true,
            revokedAt: new Date(Date.now() - 2000),
          }),
        );

        await expect(service.refreshAccessToken("late")).rejects.toThrow(
          new UnauthorizedException("Invalid or expired refresh token"),
        );

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        expect(
          mockPrismaService.refreshToken.updateMany,
        ).not.toHaveBeenCalled();
        expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
      });

      it("uses the grace window boundary: exactly at the limit counts as reuse", async () => {
        jest.useFakeTimers({ now: new Date("2026-10-30T12:00:00Z") });
        try {
          mockPrismaService.refreshToken.findUnique.mockResolvedValue(
            familyRecord({
              revoked: true,
              revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS),
            }),
          );
          jest
            .spyOn(Logger.prototype, "warn")
            .mockImplementation(() => undefined);

          await expect(service.refreshAccessToken("old")).rejects.toThrow();

          expect(
            mockPrismaService.refreshToken.updateMany,
          ).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("one tick inside the grace window is not a reuse", async () => {
        jest.useFakeTimers({ now: new Date("2026-10-30T12:00:00Z") });
        try {
          mockPrismaService.refreshToken.findUnique.mockResolvedValue(
            familyRecord({
              revoked: true,
              revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS + 1),
            }),
          );

          await expect(service.refreshAccessToken("late")).rejects.toThrow();

          expect(
            mockPrismaService.refreshToken.updateMany,
          ).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it.each([["logout"], ["a password reset"], ["an admin"]])(
        "a token revoked by %s and presented again: 401, nothing live to revoke, logged",
        async () => {
          // No live descendant: the family revocation matches no row.
          mockPrismaService.refreshToken.findUnique.mockResolvedValue(
            familyRecord({
              id: "tok-1",
              revoked: true,
              revokedAt: new Date(Date.now() - 60 * 60 * 1000),
            }),
          );
          mockPrismaService.refreshToken.updateMany.mockResolvedValue({
            count: 0,
          });
          const warn = jest
            .spyOn(Logger.prototype, "warn")
            .mockImplementation(() => undefined);

          await expect(service.refreshAccessToken("old")).rejects.toThrow(
            new UnauthorizedException("Invalid or expired refresh token"),
          );

          expect(
            mockPrismaService.refreshToken.updateMany,
          ).toHaveBeenCalledTimes(1);
          expect(
            mockPrismaService.refreshToken.updateMany.mock.calls[0][0].where,
          ).toEqual({
            userId: "u1",
            revoked: false,
            OR: [{ familyId: "fam-1" }, { id: "fam-1" }],
          });
          expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("0 live token(s) revoked"),
          );
        },
      );

      it("reuse on a disabled account revokes the family and answers the generic 401", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord({
            id: "tok-1",
            revoked: true,
            revokedAt: new Date(Date.now() - 60 * 60 * 1000),
            user: {
              id: "u1",
              email: "u@test.com",
              role: UserRole.LICENSEE,
              disabledAt: new Date(),
              club: null,
            },
          }),
        );
        const warn = jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);

        // Reuse is checked first: same answer as any revoked token, so a
        // replayed token does not reveal that the account is disabled.
        await expect(service.refreshAccessToken("stolen")).rejects.toThrow(
          new UnauthorizedException("Invalid or expired refresh token"),
        );
        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: [{ familyId: "fam-1" }, { id: "fam-1" }],
            }) as unknown,
          }),
        );
        expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
        expect(mockJwtService.sign).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("Refresh token reuse detected (user u1"),
        );
      });

      it("concurrent refreshes with the same token: one rotates, the loser revokes nothing", async () => {
        // Both callers read the token as live; the conditional consume lets
        // only the first one through (Postgres re-evaluates revoked=false).
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          familyRecord(),
        );
        mockPrismaService.refreshToken.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });

        const results = await Promise.allSettled([
          service.refreshAccessToken("same"),
          service.refreshAccessToken("same"),
        ]);

        expect(results.map((r) => r.status).sort()).toEqual([
          "fulfilled",
          "rejected",
        ]);
        // Two conditional consumes, both on the token id — no family-wide
        // updateMany, so the winner's new token survives.
        expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledTimes(
          2,
        );
        for (const [arg] of mockPrismaService.refreshToken.updateMany.mock
          .calls as [{ where: Record<string, unknown> }][]) {
          expect(arg.where).toEqual(
            expect.objectContaining({ id: "tok-2", revoked: false }),
          );
          expect(arg.where).not.toHaveProperty("OR");
        }
        expect(mockPrismaService.refreshToken.create).toHaveBeenCalledTimes(1);
      });
    });

    it("refuses a disabled account with 401 and rotates nothing", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "tok-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: "u1",
          email: "u@test.com",
          role: UserRole.LICENSEE,
          disabledAt: new Date(),
          club: null,
        },
      });

      await expect(service.refreshAccessToken("plain")).rejects.toThrow(
        new UnauthorizedException("Compte désactivé. Contactez la fédération."),
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it("refuses a CLUB account whose club is disabled", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        id: "tok-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: "u1",
          email: "c@test.com",
          role: UserRole.CLUB,
          disabledAt: null,
          club: { disabledAt: new Date() },
        },
      });

      await expect(service.refreshAccessToken("plain")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("reads the account status together with the token", async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshAccessToken("x")).rejects.toThrow();
      expect(mockPrismaService.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            user: {
              select: expect.objectContaining({
                disabledAt: true,
                club: { select: { disabledAt: true } },
              }) as unknown,
            },
          }) as unknown,
        }),
      );
    });

    describe("status re-read under the user lock (#884)", () => {
      const activeToken = (role: UserRole = UserRole.LICENSEE) => ({
        id: "rt-1",
        userId: "u1",
        familyId: "rt-1",
        revoked: false,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: {
          id: "u1",
          email: "a@b.c",
          role,
          extraRoles: [],
          disabledAt: null,
          club: role === UserRole.CLUB ? { disabledAt: null } : null,
          license: null,
        },
      });

      it("reads the status after taking the lock, before consuming the token", async () => {
        mockPrismaService.refreshToken.findUnique.mockResolvedValue(
          activeToken(),
        );
        mockJwtService.sign.mockReturnValue("jwt");

        await service.refreshAccessToken("plain");

        const lockOrder =
          mockPrismaService.$queryRaw.mock.invocationCallOrder[0];
        const statusOrder =
          mockPrismaService.user.findUnique.mock.invocationCallOrder[0];
        const consumeOrder =
          mockPrismaService.refreshToken.updateMany.mock.invocationCallOrder[0];
        expect(lockOrder).toBeLessThan(statusOrder);
        expect(statusOrder).toBeLessThan(consumeOrder);
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
          where: { id: "u1" },
          select: expect.objectContaining({
            disabledAt: true,
            club: { select: { disabledAt: true } },
          }) as unknown,
        });
      });

      it.each([
        [
          "the account was disabled",
          UserRole.LICENSEE,
          { role: UserRole.LICENSEE, disabledAt: new Date(), club: null },
        ],
        [
          "the CLUB account's club was disabled",
          UserRole.CLUB,
          {
            role: UserRole.CLUB,
            disabledAt: null,
            club: { disabledAt: new Date() },
          },
        ],
        ["the account was deleted", UserRole.LICENSEE, null],
      ])(
        "issues nothing when %s while the refresh waited",
        async (_label, role, status) => {
          mockPrismaService.refreshToken.findUnique.mockResolvedValue(
            activeToken(role),
          );
          mockPrismaService.user.findUnique.mockResolvedValue(status);

          await expect(service.refreshAccessToken("plain")).rejects.toThrow(
            new UnauthorizedException(
              "Compte désactivé. Contactez la fédération.",
            ),
          );
          expect(
            mockPrismaService.refreshToken.updateMany,
          ).not.toHaveBeenCalled();
          expect(mockPrismaService.refreshToken.create).not.toHaveBeenCalled();
          expect(mockPrismaService.user.update).not.toHaveBeenCalled();
          expect(mockJwtService.sign).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe("revokeRefreshToken", () => {
    it("should hash the token and revoke by hash", async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.revokeRefreshToken("plain-token");
      expect(result).toBe(true);
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: hashToken("plain-token"), revoked: false },
        data: expect.objectContaining({ revoked: true }),
      });
    });

    it("should return false when token not found", async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      const result = await service.revokeRefreshToken("unknown");
      expect(result).toBe(false);
    });
  });

  describe("revokeAllUserTokens", () => {
    it("should return count of revoked tokens", async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.revokeAllUserTokens("user-1");
      expect(result).toBe(3);
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revoked: false },
        data: { revoked: true, revokedAt: expect.any(Date) as unknown },
      });
    });

    it("revokes under the user lock, in one transaction (#687)", async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeAllUserTokens("user-1");

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      const call = mockPrismaService.$queryRaw.mock.calls[0] as unknown[];
      expect(rawSql(call)).toContain("FOR UPDATE");
      expect(rawValues(call)).toEqual(["user-1"]);
      expect(
        mockPrismaService.$queryRaw.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockPrismaService.refreshToken.updateMany.mock.invocationCallOrder[0],
      );
    });
  });
});
