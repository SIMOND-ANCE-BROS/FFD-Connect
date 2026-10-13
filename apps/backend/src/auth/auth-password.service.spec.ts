import { Test, TestingModule } from "@nestjs/testing";
import {
  emailLookupFor,
  oneAccountPerAddress,
} from "../../test/mocks/email-lookup.mock";
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
    // E-mail lookup (#465): each address designates one account by default.
    $queryRaw: jest.fn(oneAccountPerAddress()),
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

    it("never issues a reset link for the store-review account (shared password)", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "review-1",
        email: "licensee@test.com",
        isStoreReview: true,
      });
      const result = await service.forgotPassword("licensee@test.com");
      expect(result).toEqual({ success: true });
      expect(
        mockPrismaService.passwordResetToken.create,
      ).not.toHaveBeenCalled();
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

    describe("address typed with another casing or spaces (#465)", () => {
      const target = (id: string, email: string) => ({
        id,
        email,
        isStoreReview: false,
      });

      beforeEach(() => {
        mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({});
        mockPrismaService.passwordResetToken.create.mockResolvedValue({});
      });

      it("finds the account by its normalised address and mails the stored one", async () => {
        mockPrismaService.$queryRaw.mockResolvedValueOnce([
          { id: "u1", email: "testeur@exemple.fr" },
        ]);
        mockPrismaService.user.findUnique.mockResolvedValueOnce(
          target("u1", "testeur@exemple.fr"),
        );

        const result = await service.forgotPassword("  Testeur@Exemple.FR ");

        expect(result).toEqual({ success: true });
        expect(mockPrismaService.$queryRaw).toHaveBeenCalledWith(
          emailLookupFor("testeur@exemple.fr"),
        );
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
          where: { id: "u1" },
          select: { id: true, email: true, isStoreReview: true },
        });
        expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
          "testeur@exemple.fr",
          expect.stringMatching(/^[0-9a-f]{64}$/),
        );
      });

      it("matches a legacy account stored with upper-case letters", async () => {
        mockPrismaService.$queryRaw.mockResolvedValueOnce([
          { id: "legacy", email: "Testeur@Exemple.fr" },
        ]);
        mockPrismaService.user.findUnique.mockResolvedValueOnce(
          target("legacy", "Testeur@Exemple.fr"),
        );

        await service.forgotPassword("testeur@exemple.fr");

        expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
          "Testeur@Exemple.fr",
          expect.any(String),
        );
      });

      it.each(["%@exemple.fr", "_@exemple.fr", "a%b@exemple.fr"])(
        "never resolves the wildcard-bearing address %p to another account",
        async (typed) => {
          // Even if the database pre-filter returned someone else's row…
          mockPrismaService.$queryRaw.mockResolvedValueOnce([
            { id: "victim", email: "victim@exemple.fr" },
          ]);

          const result = await service.forgotPassword(typed);

          // …the same generic answer, and nothing issued nor sent.
          expect(result).toEqual({ success: true });
          expect(mockPrismaService.$queryRaw).toHaveBeenCalledWith(
            emailLookupFor(typed),
          );
          expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
          expect(
            mockPrismaService.passwordResetToken.create,
          ).not.toHaveBeenCalled();
          expect(
            mockEmailService.sendPasswordResetEmail,
          ).not.toHaveBeenCalled();
        },
      );

      describe("two accounts differing only by case", () => {
        const twins = [
          { id: "a", email: "Dup@exemple.fr" },
          { id: "b", email: "dup@exemple.fr" },
        ];

        it("resets the one stored exactly as typed, mailing its own address", async () => {
          mockPrismaService.$queryRaw.mockResolvedValueOnce(twins);
          mockPrismaService.user.findUnique.mockResolvedValueOnce(
            target("a", "Dup@exemple.fr"),
          );

          await service.forgotPassword(" Dup@exemple.fr ");

          expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "a" } }),
          );
          expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
            "Dup@exemple.fr",
            expect.any(String),
          );
        });

        it("sends nothing, with the same answer, when the typed casing is neither", async () => {
          mockPrismaService.$queryRaw.mockResolvedValueOnce(twins);

          const result = await service.forgotPassword("DUP@exemple.fr");

          expect(result).toEqual({ success: true });
          expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
          expect(
            mockPrismaService.passwordResetToken.create,
          ).not.toHaveBeenCalled();
          expect(
            mockEmailService.sendPasswordResetEmail,
          ).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("issuePasswordToken", () => {
    it("invalidates previous tokens, stores only the hash and returns the plain token", async () => {
      mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.passwordResetToken.create.mockResolvedValue({});
      const before = Date.now();

      const token = await service.issuePasswordToken("user-1", 168);

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(
        mockPrismaService.passwordResetToken.updateMany,
      ).toHaveBeenCalledWith({
        where: { userId: "user-1", used: false },
        data: { used: true, usedAt: expect.any(Date) },
      });
      const created =
        mockPrismaService.passwordResetToken.create.mock.calls[0][0].data;
      expect(created.token).not.toBe(token);
      expect(created.token).toBe(
        crypto.createHash("sha256").update(token).digest("hex"),
      );
      expect(created.userId).toBe("user-1");
      const expiresAt = (created.expiresAt as Date).getTime();
      expect(expiresAt - before).toBeGreaterThanOrEqual(168 * 3600_000 - 1000);
      expect(expiresAt - before).toBeLessThanOrEqual(168 * 3600_000 + 1000);
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
