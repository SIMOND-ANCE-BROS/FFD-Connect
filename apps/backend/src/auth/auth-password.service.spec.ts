import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "./email.service";
import { AuthPasswordService } from "./auth-password.service";
import { AuthTokenService } from "./auth-token.service";

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));

/** Mirror the hash logic from the service for test assertions */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("AuthPasswordService", () => {
  let service: AuthPasswordService;
  let module: TestingModule;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEmailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  const mockAuthTokenService = {
    revokeAllUserTokens: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthPasswordService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
      ],
    }).compile();

    service = module.get<AuthPasswordService>(AuthPasswordService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("forgotPassword", () => {
    it("should return success when user not found (security)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword("unknown@test.com");
      expect(result).toEqual({ success: true });
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("should store hashed token and send plain token via email", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "u@test.com",
      });
      mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({});
      mockPrismaService.passwordResetToken.create.mockResolvedValue({});

      const result = await service.forgotPassword("u@test.com");

      expect(result).toEqual({ success: true });

      // The token sent via email should be a plain 64-char hex (32 random bytes)
      const sentToken =
        mockEmailService.sendPasswordResetEmail.mock.calls[0][1];
      expect(sentToken).toHaveLength(64);

      // The token stored in DB should be a SHA-256 hash of the plain token
      const storedToken =
        mockPrismaService.passwordResetToken.create.mock.calls[0][0].data.token;
      expect(storedToken).toBe(hashToken(sentToken));
      expect(storedToken).not.toBe(sentToken);
    });
  });

  describe("resetPassword", () => {
    it("should throw when password invalid", async () => {
      await expect(service.resetPassword("token", "short")).rejects.toThrow(
        "Le mot de passe ne respecte pas",
      );
    });

    it("should lookup by hashed token", async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword("bad-token", "ValidPass1!"),
      ).rejects.toThrow("Token de réinitialisation invalide");
      expect(
        mockPrismaService.passwordResetToken.findUnique,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: hashToken("bad-token") },
        }),
      );
    });

    it("should reset password when token valid", async () => {
      const plainToken = "valid-token";
      const futureDate = new Date(Date.now() + 3600000);
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        used: false,
        expiresAt: futureDate,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed");
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.passwordResetToken.update.mockResolvedValue({});
      mockAuthTokenService.revokeAllUserTokens.mockResolvedValue(0);

      const result = await service.resetPassword(plainToken, "ValidPass1!");

      expect(result).toEqual({ success: true });
      expect(
        mockPrismaService.passwordResetToken.findUnique,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: hashToken(plainToken) },
        }),
      );
      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockAuthTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        "u1",
      );
    });

    it("should throw when token already used", async () => {
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "rt1",
        used: true,
      });
      await expect(
        service.resetPassword("used-token", "ValidPass1!"),
      ).rejects.toThrow("Token de réinitialisation invalide");
    });

    it("should throw when token expired", async () => {
      const pastDate = new Date(Date.now() - 3600000);
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "rt1",
        used: false,
        expiresAt: pastDate,
      });
      await expect(
        service.resetPassword("expired-token", "ValidPass1!"),
      ).rejects.toThrow("Token de réinitialisation invalide");
    });
  });

  describe("changePassword", () => {
    it("should throw when user not found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword("u1", "OldPass1!", "NewValid1!"),
      ).rejects.toThrow("Utilisateur non trouvé");
    });

    it("should throw when current password wrong", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        password: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.changePassword("u1", "WrongPass1!", "NewValid1!"),
      ).rejects.toThrow("Mot de passe actuel incorrect");
    });

    it("should change password when valid", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        password: "hashed-old",
      });
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-new");
      mockPrismaService.user.update.mockResolvedValue({});

      const result = await service.changePassword(
        "u1",
        "OldPass1!",
        "NewValid1!",
      );

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.user.update).toHaveBeenCalled();
    });

    it("should throw when new password is same as old", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        password: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.changePassword("u1", "OldPass1!", "OldPass1!"),
      ).rejects.toThrow("Le nouveau mot de passe doit être différent");
    });

    it("should throw when new password does not meet policy", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
        password: "hashed",
      });
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      await expect(
        service.changePassword("u1", "OldPass1!", "short"),
      ).rejects.toThrow("Le mot de passe ne respecte pas");
    });
  });
});
