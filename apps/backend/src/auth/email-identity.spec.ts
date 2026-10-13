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
  trimEmailTransform,
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

  describe("trimEmailTransform", () => {
    it("trims but keeps the casing as typed", () => {
      expect(trimEmailTransform({ value: " Dup@X.fr " })).toBe("Dup@X.fr");
    });

    it.each([undefined, null, 42])("passes %p through", (value) => {
      expect(trimEmailTransform({ value })).toBe(value);
    });
  });

  describe("DTOs", () => {
    it("lookup DTOs (forgot password, login, impersonation) trim and keep the typed casing", async () => {
      const forgot = plainToInstance(ForgotPasswordDto, {
        email: "  Testeur@Exemple.fr ",
      });
      expect(forgot.email).toBe("Testeur@Exemple.fr");
      expect(await validate(forgot)).toHaveLength(0);

      const login = plainToInstance(LoginDto, {
        username: " Testeur@Exemple.fr ",
        password: "pw",
      });
      expect(login.username).toBe("Testeur@Exemple.fr");
      expect(await validate(login)).toHaveLength(0);

      expect(
        plainToInstance(ImpersonateDto, { targetEmail: " A@B.fr " })
          .targetEmail,
      ).toBe("A@B.fr");
    });

    it("ForgotPasswordDto still rejects a non-address", async () => {
      const dto = plainToInstance(ForgotPasswordDto, { email: " nope " });
      expect(await validate(dto)).not.toHaveLength(0);
    });

    it("stored-address DTOs (register, admin identifiers) normalise", () => {
      expect(plainToInstance(RegisterDto, { email: " A@B.fr " }).email).toBe(
        "a@b.fr",
      );
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

  describe("stored-address DTOs accept ASCII only", () => {
    it.each([
      "\u212Aate@x.fr", // Kelvin sign
      "\u0130nes@x.fr", // dotted capital I
      "jos\u00e9@x.fr",
      "jose@exempl\u00e9.fr", // IDN domain not in punycode
    ])("refuses %p", async (email) => {
      for (const dto of [
        plainToInstance(RegisterDto, {
          email,
          password: "Pass1!word",
          licenseNumber: "FFD-1",
          lastName: "Doe",
          firstName: "Jo",
        }),
        plainToInstance(UpdateAdminUserIdentifiersDto, { email }),
      ]) {
        const errors = await validate(dto);
        expect(errors.map((e) => e.property)).toContain("email");
      }
    });

    it("accepts an ASCII address with underscores and a punycode domain", async () => {
      const dto = plainToInstance(UpdateAdminUserIdentifiersDto, {
        email: "Jean_Dupont@xn--exempl-gva.fr",
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.email).toBe("jean_dupont@xn--exempl-gva.fr");
    });
  });

  describe("lookups", () => {
    const db = { $queryRaw: jest.fn() };
    const client = db as unknown as Parameters<typeof findUserIdByEmail>[0];
    const lastQuery = () =>
      db.$queryRaw.mock.calls.at(-1)?.[0] as {
        text: string;
        values: unknown[];
      };

    beforeEach(() => {
      db.$queryRaw.mockReset();
    });

    it("compares ASCII-folded in SQL, exact-typed row first, bounded", async () => {
      db.$queryRaw.mockResolvedValue([{ id: "u1", email: "a@b.fr" }]);

      await expect(findUserIdByEmail(client, " A@B.fr ")).resolves.toBe("u1");
      const { text, values } = lastQuery();
      expect(text).toContain('lower(email COLLATE "C") = $1');
      expect(text).toContain("ORDER BY (email = $2) DESC, id ASC");
      expect(text).toContain("LIMIT $3");
      expect(text).not.toMatch(/LIKE/i);
      expect(text).not.toContain("id <>");
      expect(values).toEqual(["a@b.fr", "A@B.fr", 5]);
    });

    it("finds a legacy account stored with capitals", async () => {
      db.$queryRaw.mockResolvedValue([{ id: "legacy", email: "A@B.fr" }]);

      await expect(findUserIdByEmail(client, "a@b.fr")).resolves.toBe("legacy");
    });

    it("passes wildcard characters as plain values, never as a pattern", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await expect(findUserIdByEmail(client, "%@b.fr")).resolves.toBeNull();
      expect(lastQuery().values[0]).toBe("%@b.fr");
    });

    it("never keeps a row that does not normalise to the typed address", async () => {
      db.$queryRaw.mockResolvedValue([
        { id: "victim", email: "victim@b.fr" },
        { id: "kate", email: "\u212Aate@x.fr" },
      ]);

      await expect(findUserIdByEmail(client, "kate@x.fr")).resolves.toBeNull();
      await expect(isEmailTaken(client, "kate@x.fr")).resolves.toBe(false);
    });

    it("keeps the genuine match next to a rejected row", async () => {
      db.$queryRaw.mockResolvedValue([
        { id: "noise", email: "\u212Aate@x.fr" },
        { id: "kate", email: "KATE@x.fr" },
      ]);

      await expect(findUserIdByEmail(client, "kate@x.fr")).resolves.toBe(
        "kate",
      );
    });

    it("returns null when no account matches", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await expect(findUserIdByEmail(client, "x@y.fr")).resolves.toBeNull();
    });

    describe("accounts differing only by case: never merged", () => {
      const twins = [
        { id: "a", email: "Alice@x.fr" },
        { id: "b", email: "alice@x.fr" },
      ];

      it.each([
        ["Alice@x.fr", "a"],
        ["  Alice@x.fr ", "a"],
        ["alice@x.fr", "b"],
      ])(
        "%p designates only the account stored exactly so",
        async (typed, id) => {
          db.$queryRaw.mockResolvedValue(twins);
          await expect(findUserIdByEmail(client, typed)).resolves.toBe(id);
        },
      );

      it("refuses any other casing (no arbitrary pick)", async () => {
        db.$queryRaw.mockResolvedValue(twins);
        await expect(
          findUserIdByEmail(client, "ALICE@x.fr"),
        ).resolves.toBeNull();
      });

      it("isEmailTaken: a new address colliding with either twin is taken", async () => {
        db.$queryRaw.mockResolvedValue(twins);
        await expect(isEmailTaken(client, "ALICE@X.FR")).resolves.toBe(true);
      });
    });

    it("isEmailTaken: true on a match, false otherwise", async () => {
      db.$queryRaw.mockResolvedValueOnce([{ id: "legacy", email: "A@b.fr" }]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(true);

      db.$queryRaw.mockResolvedValueOnce([]);
      await expect(isEmailTaken(client, "a@b.fr")).resolves.toBe(false);
    });

    it("isEmailTaken: excludes the account being edited", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await isEmailTaken(client, "a@b.fr", "self");
      const { text, values } = lastQuery();
      expect(text).toContain("AND id <> $2");
      expect(values).toEqual(["a@b.fr", "self", "a@b.fr", 5]);
    });
  });
});
