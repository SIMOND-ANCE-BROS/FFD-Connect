import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAdminUserIdentifiersDto } from "../admin/dto/admin-user-identifiers.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ImpersonateDto } from "./dto/impersonate.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import {
  escapeLikePattern,
  findUserIdByEmail,
  isEmailTaken,
  normalizeEmail,
  normalizeEmailTransform,
} from "./email-identity";

describe("email identity (#465)", () => {
  describe("normalizeEmail", () => {
    it("trims and lower-cases", () => {
      expect(normalizeEmail("  Prenom.Nom@Exemple.FR \t")).toBe(
        "prenom.nom@exemple.fr",
      );
    });

    it("leaves an already normalised address unchanged", () => {
      expect(normalizeEmail("a@b.fr")).toBe("a@b.fr");
    });
  });

  describe("normalizeEmailTransform", () => {
    it("normalises strings", () => {
      expect(normalizeEmailTransform({ value: " A@B.fr " })).toBe("a@b.fr");
    });

    it.each([undefined, null, 42, ["A@B.fr"]])(
      "passes %p through to the validators",
      (value) => {
        expect(normalizeEmailTransform({ value })).toBe(value);
      },
    );
  });

  describe("DTOs normalise the address before validation", () => {
    it("ForgotPasswordDto accepts and normalises a padded, capitalised address", async () => {
      const dto = plainToInstance(ForgotPasswordDto, {
        email: "  Testeur@Exemple.fr ",
      });
      expect(dto.email).toBe("testeur@exemple.fr");
      expect(await validate(dto)).toHaveLength(0);
    });

    it("ForgotPasswordDto still rejects a non-address", async () => {
      const dto = plainToInstance(ForgotPasswordDto, { email: " nope " });
      expect(await validate(dto)).not.toHaveLength(0);
    });

    it("LoginDto normalises the username", async () => {
      const dto = plainToInstance(LoginDto, {
        username: " Testeur@Exemple.fr ",
        password: "pw",
      });
      expect(dto.username).toBe("testeur@exemple.fr");
      expect(await validate(dto)).toHaveLength(0);
    });

    it("RegisterDto, ImpersonateDto and the admin identifiers DTO normalise the email", () => {
      expect(plainToInstance(RegisterDto, { email: " A@B.fr " }).email).toBe(
        "a@b.fr",
      );
      expect(
        plainToInstance(ImpersonateDto, { targetEmail: " A@B.fr " })
          .targetEmail,
      ).toBe("a@b.fr");
      expect(
        plainToInstance(UpdateAdminUserIdentifiersDto, { email: " A@B.fr " })
          .email,
      ).toBe("a@b.fr");
    });
  });

  describe("normalizeEmail — ASCII only", () => {
    it("does not fold Unicode look-alikes onto ASCII letters", () => {
      // Kelvin sign (U+212A) would become "k" with String#toLowerCase.
      expect(normalizeEmail("\u212Aate@x.fr")).toBe("\u212Aate@x.fr");
      expect(normalizeEmail("\u0130nes@x.fr")).toBe("\u0130nes@x.fr");
    });
  });

  describe("escapeLikePattern", () => {
    it("escapes %, _ and backslash", () => {
      expect(escapeLikePattern("a%b_c\\d@x.fr")).toBe("a\\%b\\_c\\\\d@x.fr");
    });

    it("leaves an ordinary address unchanged", () => {
      expect(escapeLikePattern("prenom.nom+tag@x.fr")).toBe(
        "prenom.nom+tag@x.fr",
      );
    });
  });

  describe("lookups", () => {
    const db = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const client = db as unknown as Parameters<typeof findUserIdByEmail>[0];

    beforeEach(() => {
      db.user.findUnique.mockReset();
      db.user.findMany.mockReset();
    });

    it("uses the exact match on the normalised form first", async () => {
      db.user.findUnique.mockResolvedValue({ id: "u1" });

      await expect(findUserIdByEmail(client, " A@B.fr ")).resolves.toBe("u1");
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: "a@b.fr" },
        select: { id: true },
      });
      expect(db.user.findMany).not.toHaveBeenCalled();
    });

    it("falls back to a bounded, escaped case-insensitive match for legacy rows", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([{ id: "legacy", email: "A@B.fr" }]);

      await expect(findUserIdByEmail(client, "a@b.fr")).resolves.toBe("legacy");
      expect(db.user.findMany).toHaveBeenCalledWith({
        where: { email: { equals: "a@b.fr", mode: "insensitive" } },
        select: { id: true, email: true },
        take: 5,
      });
    });

    it.each(["%@b.fr", "_@b.fr", "a%b@b.fr", "a_b@b.fr"])(
      "never lets the wildcard-bearing %p designate another account",
      async (typed) => {
        db.user.findUnique.mockResolvedValue(null);
        db.user.findMany.mockResolvedValue([
          { id: "victim", email: "victim@b.fr" },
          { id: "other", email: "AXB@b.fr" },
        ]);

        await expect(findUserIdByEmail(client, typed)).resolves.toBeNull();
        await expect(isEmailTaken(client, typed)).resolves.toBe(false);
        expect(db.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              email: {
                equals: escapeLikePattern(typed),
                mode: "insensitive",
              },
            },
          }),
        );
      },
    );

    it("rejects a candidate the database folded but the application does not (Unicode)", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([{ id: "kate", email: "Kate@x.fr" }]);

      await expect(
        findUserIdByEmail(client, "\u212Aate@x.fr"),
      ).resolves.toBeNull();
    });

    it("keeps the genuine legacy match next to a rejected candidate", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([
        { id: "noise", email: "\u212Aate@x.fr" },
        { id: "kate", email: "KATE@x.fr" },
      ]);

      await expect(findUserIdByEmail(client, "kate@x.fr")).resolves.toBe(
        "kate",
      );
    });

    it("returns null when no account matches", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([]);

      await expect(findUserIdByEmail(client, "x@y.fr")).resolves.toBeNull();
    });

    it("refuses to choose between accounts differing only by case", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([
        { id: "a", email: "X@y.fr" },
        { id: "b", email: "x@Y.FR" },
      ]);

      await expect(findUserIdByEmail(client, "x@y.fr")).resolves.toBeNull();
    });

    it("isEmailTaken: true on an exact, a legacy or an ambiguous match", async () => {
      db.user.findUnique.mockResolvedValueOnce({ id: "u1" });
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);

      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValueOnce([
        { id: "legacy", email: "A@b.fr" },
      ]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);

      db.user.findMany.mockResolvedValueOnce([
        { id: "a", email: "A@b.fr" },
        { id: "b", email: "a@B.fr" },
      ]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);
    });

    it("isEmailTaken: false when nothing matches", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([]);

      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(false);
    });
  });
});
