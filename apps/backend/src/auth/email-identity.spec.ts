import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAdminUserIdentifiersDto } from "../admin/dto/admin-user-identifiers.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ImpersonateDto } from "./dto/impersonate.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import {
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

    it("falls back to a bounded case-insensitive match for legacy rows", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([{ id: "legacy" }]);

      await expect(findUserIdByEmail(client, "a@b.fr")).resolves.toBe("legacy");
      expect(db.user.findMany).toHaveBeenCalledWith({
        where: { email: { equals: "a@b.fr", mode: "insensitive" } },
        select: { id: true },
        take: 2,
      });
    });

    it("returns null when no account matches", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([]);

      await expect(findUserIdByEmail(client, "x@y.fr")).resolves.toBeNull();
    });

    it("refuses to choose between accounts differing only by case", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

      await expect(findUserIdByEmail(client, "x@y.fr")).resolves.toBeNull();
    });

    it("isEmailTaken: true on an exact, a legacy or an ambiguous match", async () => {
      db.user.findUnique.mockResolvedValueOnce({ id: "u1" });
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);

      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValueOnce([{ id: "legacy" }]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);

      db.user.findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);
    });

    it("isEmailTaken: false when nothing matches", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([]);

      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(false);
    });
  });
});
