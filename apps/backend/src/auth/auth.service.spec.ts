import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));

describe("AuthService", () => {
  let service: AuthService;
  let module: TestingModule;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    impersonationLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockAuthTokenService = {
    createRefreshToken: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("validateUser", () => {
    it("should return user without password if validation succeeds", async () => {
      const mockUser = {
        id: "u1",
        email: "test@example.com",
        password: "hashedpassword",
        firstName: "Test",
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser("test@example.com", "password");
      expect(result).toEqual({
        id: "u1",
        email: "test@example.com",
        firstName: "Test",
      });
    });

    it("should return null if user not found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.validateUser(
        "notfound@example.com",
        "password",
      );
      expect(result).toBeNull();
    });

    it("should return null if password mismatch", async () => {
      const mockUser = {
        id: "u1",
        password: "hashedpassword",
      };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(
        "test@example.com",
        "wrongpassword",
      );
      expect(result).toBeNull();
    });

    it("should fallback to minimal query on P2021 schema error", async () => {
      const minimalUser = {
        id: "u1",
        email: "test@example.com",
        password: "hashed",
        firstName: "Test",
        lastName: "User",
        role: "LICENSEE",
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubName: null,
      };

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Column does not exist",
        { code: "P2021", clientVersion: "7.0.0" },
      );

      mockPrismaService.user.findUnique
        .mockRejectedValueOnce(prismaError)
        .mockResolvedValueOnce(minimalUser);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(12);

      const result = await service.validateUser("test@example.com", "password");

      expect(result).not.toBeNull();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should fallback on error message containing 'does not exist'", async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "The column `passportLevelLatin` does not exist in the table",
        { code: "P2022", clientVersion: "7.0.0" },
      );

      mockPrismaService.user.findUnique
        .mockRejectedValueOnce(prismaError)
        .mockResolvedValueOnce(null);

      const result = await service.validateUser("test@example.com", "password");

      expect(result).toBeNull();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should re-throw non-schema Prisma errors", async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Connection refused",
        { code: "P1001", clientVersion: "7.0.0" },
      );

      mockPrismaService.user.findUnique.mockRejectedValue(prismaError);

      await expect(
        service.validateUser("test@example.com", "password"),
      ).rejects.toThrow("Connection refused");
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should re-throw non-Prisma errors", async () => {
      mockPrismaService.user.findUnique.mockRejectedValue(
        new Error("Network timeout"),
      );

      await expect(
        service.validateUser("test@example.com", "password"),
      ).rejects.toThrow("Network timeout");
    });
  });

  describe("login", () => {
    it("should return access token, refresh token and user info", async () => {
      const mockUser = {
        id: "u1",
        email: "test@example.com",
        role: UserRole.LICENSEE,
        clubName: "Club",
        firstName: "First",
        lastName: "Last",
        license: { number: "LIC123" },
        password: "hashedpassword",
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        birthDate: null,
        nationalRanking: null,
      };

      mockJwtService.sign.mockReturnValue("jwt-token");
      mockAuthTokenService.createRefreshToken.mockResolvedValue({
        id: "token-id",
        token: "refresh-token",
        userId: "u1",
        expiresAt: new Date(),
        revoked: false,
        revokedAt: null,
      });

      const result = await service.login(mockUser as never);

      expect(result).toEqual({
        access_token: "jwt-token",
        refresh_token: "refresh-token",
        user: expect.objectContaining({
          id: "u1",
          email: "test@example.com",
          licenseNumber: "LIC123",
        }) as unknown,
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: "u1",
          email: "test@example.com",
        }),
        expect.objectContaining({
          expiresIn: expect.any(String),
        }),
      );
      expect(mockAuthTokenService.createRefreshToken).toHaveBeenCalledWith(
        "u1",
      );
    });
  });

  describe("validateUser — rehash bcrypt transparent", () => {
    it("should rehash password with 12 rounds when existing hash has fewer rounds", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        password: "hashed-with-6-rounds",
        firstName: "Test",
        lastName: "User",
        role: "LICENSEE",
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest.fn().mockResolvedValue(mockUser);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(6);
      (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash-12-rounds");

      await service.validateUser("test@example.com", "password");

      expect(bcrypt.hash).toHaveBeenCalledWith("password", 12);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { password: "new-hash-12-rounds" },
      });
    });

    it("should not throw when rehash DB update fails", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        password: "hashed-with-6-rounds",
        firstName: "Test",
        lastName: "User",
        role: "LICENSEE",
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest
        .fn()
        .mockRejectedValue(new Error("DB timeout"));

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(6);
      (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash-12-rounds");

      const result = await service.validateUser("test@example.com", "password");
      expect(result).not.toBeNull();
    });

    it("should NOT rehash password when existing hash already has 12 rounds", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        password: "hashed-with-12-rounds",
        firstName: "Test",
        lastName: "User",
        role: "LICENSEE",
        createdAt: new Date(),
        updatedAt: new Date(),
        ageGroup: null,
        category: null,
        clubId: null,
        clubName: null,
        birthDate: null,
        nationalRanking: null,
        passportLevelLatin: null,
        passportLevelStandard: null,
        competitionLevel: null,
        license: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update = jest.fn();

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.getRounds as jest.Mock).mockReturnValue(12);

      await service.validateUser("test@example.com", "password");

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });
  });

  describe("impersonate (#545)", () => {
    const licenseeTarget = {
      id: "target-1",
      email: "lic@test.com",
      role: UserRole.LICENSEE,
      firstName: "L",
      lastName: "T",
      clubId: null,
      clubName: null,
    };

    it("admin impersonne un licencié : token signé avec impersonatedBy + audit", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(licenseeTarget);
      mockPrismaService.impersonationLog.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue("imp-token");

      const res = await service.impersonate(
        "admin-1",
        "ADMIN",
        { userId: "target-1" },
        undefined,
        "1.2.3.4",
      );

      expect(res.access_token).toBe("imp-token");
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "target-1", impersonatedBy: "admin-1" }),
        expect.objectContaining({ expiresIn: expect.stringContaining("m") }),
      );
      expect(mockPrismaService.impersonationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: "admin-1",
            targetUserId: "target-1",
            targetRole: UserRole.LICENSEE,
          }),
        }),
      );
    });

    it("refuse d'impersonner un admin", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...licenseeTarget,
        role: UserRole.ADMIN,
      });
      await expect(
        service.impersonate(
          "admin-1",
          "ADMIN",
          { userId: "target-1" },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.impersonationLog.create).not.toHaveBeenCalled();
    });

    it("refuse un acteur non admin/staff", async () => {
      await expect(
        service.impersonate(
          "u-1",
          "LICENSEE",
          { userId: "target-1" },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuse de s'impersonner soi-même", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...licenseeTarget,
        id: "admin-1",
      });
      await expect(
        service.impersonate(
          "admin-1",
          "ADMIN",
          { userId: "admin-1" },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("cible introuvable → NotFound", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(
        service.impersonate(
          "admin-1",
          "ADMIN",
          { email: "ghost@test.com" },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("staff sans raison → BadRequest", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(licenseeTarget);
      await expect(
        service.impersonate(
          "staff-1",
          "STAFF",
          { userId: "target-1" },
          "  ",
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("stopImpersonation clôt le log ouvert", async () => {
      mockPrismaService.impersonationLog.findFirst.mockResolvedValue({
        id: "log-1",
      });
      mockPrismaService.impersonationLog.update.mockResolvedValue({});

      await service.stopImpersonation("admin-1");

      expect(mockPrismaService.impersonationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "log-1" },
          data: expect.objectContaining({ endedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
