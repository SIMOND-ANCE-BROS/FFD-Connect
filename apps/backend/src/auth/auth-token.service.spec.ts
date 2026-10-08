import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthTokenService } from "./auth-token.service";

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
    },
    $transaction: jest.fn(),
  };

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
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);
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
      mockPrismaService.$transaction.mockResolvedValue([{}, {}, {}]);
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
      mockPrismaService.user.update.mockReturnValue("user-update-op");
      mockPrismaService.$transaction.mockResolvedValue([{}, {}, {}]);
      mockJwtService.sign.mockReturnValue("new-access");

      await service.refreshAccessToken("old-refresh-plain");

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { lastLoginAt: expect.any(Date) as unknown },
        select: { id: true },
      });
      const ops = mockPrismaService.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toContain("user-update-op");
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
        revoked: true,
        expiresAt: new Date(Date.now() + 86400000),
      });
      await expect(service.refreshAccessToken("revoked-token")).rejects.toThrow(
        "Invalid or expired refresh token",
      );
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
          include: {
            user: {
              select: expect.objectContaining({
                disabledAt: true,
                club: { select: { disabledAt: true } },
              }) as unknown,
            },
          },
        }),
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
    });
  });
});
