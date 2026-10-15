import { Test, TestingModule } from "@nestjs/testing";
import {
  emailLookupFor,
  oneAccountPerAddress,
} from "../../test/mocks/email-lookup.mock";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import * as Sentry from "@sentry/nestjs";
import { EmailSendError, EmailService } from "./email.service";
import { AuthPasswordService } from "./auth-password.service";
import { AuthTokenService } from "./auth-token.service";

jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }));

/** Lets detached promise chains (mocks resolve immediately) settle. */
const flushDetached = () => new Promise((r) => setImmediate(r));

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
    // An async method: always a promise (the send is detached, #610).
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
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
    // No account unless a test says so: the unknown-address path also reads
    // a (random) id since #610, it must never get a previous test's user.
    mockPrismaService.user.findUnique.mockReset();
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

    it.each([
      ["open breaker", new Error("Service email is temporarily unavailable")],
      ["timeout", new Error("[Timeout] resend:password-reset timed out")],
    ])(
      "keeps the generic answer when the mail fails (%s, #464)",
      async (_case, failure) => {
        mockPrismaService.user.findUnique.mockResolvedValue({
          id: "u1",
          email: "u@test.com",
        });
        mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({});
        mockPrismaService.passwordResetToken.create.mockResolvedValue({});
        mockEmailService.sendPasswordResetEmail.mockRejectedValueOnce(failure);

        await expect(service.forgotPassword("u@test.com")).resolves.toEqual({
          success: true,
        });
      },
    );

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
          // Only the decoy lookup of a random id (#610), never the victim.
          expect(mockPrismaService.user.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "victim" } }),
          );
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
          // Only the decoy lookup of a random id (#610), never a twin.
          for (const id of ["a", "b"]) {
            expect(mockPrismaService.user.findUnique).not.toHaveBeenCalledWith(
              expect.objectContaining({ where: { id } }),
            );
          }
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

  describe("forgotPassword response does not reveal the account (#610)", () => {
    const known = { id: "u1", email: "u@test.com", isStoreReview: false };

    /** The Prisma operations a call ran, in order, by model.method. */
    const prismaCalls = () =>
      [
        ["$queryRaw", mockPrismaService.$queryRaw],
        ["user.findUnique", mockPrismaService.user.findUnique],
        ["token.updateMany", mockPrismaService.passwordResetToken.updateMany],
        ["token.create", mockPrismaService.passwordResetToken.create],
        ["token.findUnique", mockPrismaService.passwordResetToken.findUnique],
      ]
        .flatMap(([name, fn]) =>
          (fn as jest.Mock).mock.invocationCallOrder.map(
            (order) => [order, name] as const,
          ),
        )
        .sort((a, b) => a[0] - b[0])
        .map(([, name]) => name);

    beforeEach(() => {
      mockPrismaService.passwordResetToken.updateMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.passwordResetToken.create.mockResolvedValue({});
      mockPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
      mockEmailService.sendPasswordResetEmail.mockResolvedValue(undefined);
    });

    it("answers without waiting for the e-mail to be sent", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(known);
      // Resend never answers: the request must not hang on it.
      mockEmailService.sendPasswordResetEmail.mockReturnValueOnce(
        new Promise(() => undefined),
      );

      await expect(service.forgotPassword("u@test.com")).resolves.toEqual({
        success: true,
      });
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it("runs the same number of queries, in the same order, for an unknown address", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(known);
      await service.forgotPassword("u@test.com");
      const knownPath = prismaCalls();
      jest.clearAllMocks();

      mockPrismaService.$queryRaw.mockResolvedValueOnce([]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      await service.forgotPassword("nobody@test.com");
      const unknownPath = prismaCalls();

      expect(knownPath).toEqual([
        "$queryRaw",
        "user.findUnique",
        "token.updateMany",
        "token.create",
      ]);
      expect(unknownPath).toEqual([
        "$queryRaw",
        "user.findUnique",
        "token.updateMany",
        "token.findUnique",
      ]);
    });

    it("the unknown-address decoy matches no account and writes no row", async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);

      await service.forgotPassword("nobody@test.com");

      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      const lookedUp =
        mockPrismaService.user.findUnique.mock.calls[0][0].where.id;
      expect(lookedUp).toMatch(uuid);
      const decoyWhere =
        mockPrismaService.passwordResetToken.updateMany.mock.calls[0][0].where;
      expect(decoyWhere.userId).toMatch(uuid);
      expect(decoyWhere.userId).not.toBe(lookedUp);
      expect(
        mockPrismaService.passwordResetToken.findUnique,
      ).toHaveBeenCalledWith({
        where: { token: expect.stringMatching(/^[0-9a-f]{64}$/) },
        select: { id: true },
      });
      expect(
        mockPrismaService.passwordResetToken.create,
      ).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("the store-review account takes the same decoy path", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        ...known,
        isStoreReview: true,
      });

      await service.forgotPassword("u@test.com");

      expect(prismaCalls()).toEqual([
        "$queryRaw",
        "user.findUnique",
        "token.updateMany",
        "token.findUnique",
      ]);
      expect(
        mockPrismaService.passwordResetToken.updateMany.mock.calls[0][0].where
          .userId,
      ).not.toBe(known.id);
      expect(
        mockPrismaService.passwordResetToken.create,
      ).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("reports a failed send without the address, the token nor Resend's message", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(known);
      mockEmailService.sendPasswordResetEmail.mockRejectedValueOnce(
        new EmailSendError("u@test.com is on the suppression list", 422),
      );

      await expect(service.forgotPassword("u@test.com")).resolves.toEqual({
        success: true,
      });
      await flushDetached();

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      const reported = (Sentry.captureException as jest.Mock).mock
        .calls[0][0] as Error;
      expect(reported.message).toBe(
        "Password reset e-mail not sent (EmailSendError 422)",
      );
      const sentToken =
        mockEmailService.sendPasswordResetEmail.mock.calls[0][1];
      expect(reported.message).not.toContain("u@test.com");
      expect(reported.message).not.toContain(sentToken);
    });

    it("reports a non-Error rejection by its kind only", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(known);
      mockEmailService.sendPasswordResetEmail.mockRejectedValueOnce("boom");

      await service.forgotPassword("u@test.com");
      await flushDetached();

      expect(
        (Sentry.captureException as jest.Mock).mock.calls[0][0].message,
      ).toBe("Password reset e-mail not sent (unknown)");
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
