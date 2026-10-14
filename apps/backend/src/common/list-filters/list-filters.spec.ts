import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListAdminUsersQueryDto } from "../../admin/dto/admin-users.dto";
import {
  allowedOps,
  enumColumn,
  type FilterColumns,
  type ListFilter,
  listFiltersError,
  listFiltersWhere,
  MAX_LIST_FILTERS,
  parseListFiltersParam,
} from "./list-filters";

/** A fake model: the builders return plain objects naming the column. */
type Where = Record<string, unknown>;

const COLUMNS: FilterColumns<Where> = {
  name: { kind: "text", where: (c) => ({ name: c }) },
  club: {
    kind: "text",
    where: (c) => ({ club: c }),
    whereNull: { club: null },
  },
  createdAt: { kind: "date", where: (c) => ({ createdAt: c }) },
  lastLoginAt: {
    kind: "date",
    where: (c) => ({ lastLoginAt: c }),
    whereNull: { lastLoginAt: null },
  },
  bpm: { kind: "number", where: (c) => ({ bpm: c }) },
  role: enumColumn(["CLUB", "ADMIN"] as const, (role) => ({ role })),
  reason: enumColumn(
    ["WRONG_TITLE", "OTHER"] as const,
    (reason) => ({ reason }),
    { reason: null },
  ),
};

const where = (filter: ListFilter): Where => {
  const [condition] = listFiltersWhere(COLUMNS, [filter]);
  return condition;
};

const insensitive = { mode: "insensitive" };

describe("list filters (#557)", () => {
  describe("text operators", () => {
    it("contains, startsWith and equals, case-insensitively", () => {
      expect(where({ field: "name", op: "contains", value: "mar" })).toEqual({
        name: { contains: "mar", ...insensitive },
      });
      expect(where({ field: "name", op: "startsWith", value: "Ma" })).toEqual({
        name: { startsWith: "Ma", ...insensitive },
      });
      expect(where({ field: "name", op: "equals", value: "Martin" })).toEqual({
        name: { equals: "Martin", ...insensitive },
      });
    });

    it("notContains keeps the rows without value on a nullable column", () => {
      expect(where({ field: "name", op: "notContains", value: "x" })).toEqual({
        NOT: { name: { contains: "x", ...insensitive } },
      });
      expect(where({ field: "club", op: "notContains", value: "x" })).toEqual({
        OR: [
          { club: null },
          { NOT: { club: { contains: "x", ...insensitive } } },
        ],
      });
    });

    it("isEmpty matches NULL and the empty string; isNotEmpty is its negation", () => {
      expect(where({ field: "club", op: "isEmpty" })).toEqual({
        OR: [{ club: null }, { club: { equals: "" } }],
      });
      expect(where({ field: "club", op: "isNotEmpty" })).toEqual({
        NOT: { OR: [{ club: null }, { club: { equals: "" } }] },
      });
      // A required text column can still be blank.
      expect(where({ field: "name", op: "isEmpty" })).toEqual({
        name: { equals: "" },
      });
    });
  });

  describe("date operators (Paris days)", () => {
    // 2026-10-14 starts at 2026-10-13T22:00Z in Paris (summer time).
    const start14 = new Date("2026-10-13T22:00:00.000Z");
    const start15 = new Date("2026-10-14T22:00:00.000Z");

    it("before, after, on and between whole days", () => {
      expect(
        where({ field: "createdAt", op: "lt", value: "2026-10-14" }),
      ).toEqual({ createdAt: { lt: start14 } });
      expect(
        where({ field: "createdAt", op: "gt", value: "2026-10-14" }),
      ).toEqual({ createdAt: { gte: start15 } });
      expect(
        where({ field: "createdAt", op: "eq", value: "2026-10-14" }),
      ).toEqual({ createdAt: { gte: start14, lt: start15 } });
      expect(
        where({
          field: "createdAt",
          op: "between",
          value: ["2026-10-14", "2026-10-14"],
        }),
      ).toEqual({ createdAt: { gte: start14, lt: start15 } });
    });

    it("crosses a winter-time day correctly", () => {
      expect(
        where({ field: "createdAt", op: "eq", value: "2026-12-01" }),
      ).toEqual({
        createdAt: {
          gte: new Date("2026-11-30T23:00:00.000Z"),
          lt: new Date("2026-12-01T23:00:00.000Z"),
        },
      });
    });

    it("isEmpty / isNotEmpty on a nullable date", () => {
      expect(where({ field: "lastLoginAt", op: "isEmpty" })).toEqual({
        lastLoginAt: null,
      });
      expect(where({ field: "lastLoginAt", op: "isNotEmpty" })).toEqual({
        NOT: { lastLoginAt: null },
      });
    });
  });

  describe("number operators", () => {
    it("<, >, = and between (inclusive)", () => {
      expect(where({ field: "bpm", op: "lt", value: 30 })).toEqual({
        bpm: { lt: 30 },
      });
      expect(where({ field: "bpm", op: "gt", value: 30 })).toEqual({
        bpm: { gt: 30 },
      });
      expect(where({ field: "bpm", op: "eq", value: 30 })).toEqual({
        bpm: { equals: 30 },
      });
      expect(where({ field: "bpm", op: "between", value: [28, 31] })).toEqual({
        bpm: { gte: 28, lte: 31 },
      });
    });
  });

  describe("enum operators", () => {
    it("in and notIn", () => {
      expect(
        where({ field: "role", op: "in", value: ["CLUB", "ADMIN"] }),
      ).toEqual({ OR: [{ role: "CLUB" }, { role: "ADMIN" }] });
      expect(where({ field: "role", op: "notIn", value: ["CLUB"] })).toEqual({
        NOT: { OR: [{ role: "CLUB" }] },
      });
    });

    it("notIn keeps empty rows and isEmpty matches them on a nullable column", () => {
      expect(where({ field: "reason", op: "notIn", value: ["OTHER"] })).toEqual(
        {
          OR: [{ reason: null }, { NOT: { OR: [{ reason: "OTHER" }] } }],
        },
      );
      expect(where({ field: "reason", op: "isEmpty" })).toEqual({
        reason: null,
      });
    });
  });

  it("returns one condition per filter, to AND, and none without filters", () => {
    expect(listFiltersWhere(COLUMNS, undefined)).toEqual([]);
    expect(
      listFiltersWhere(COLUMNS, [
        { field: "name", op: "contains", value: "a" },
        { field: "bpm", op: "gt", value: 1 },
      ]),
    ).toHaveLength(2);
  });

  describe("validation: nothing outside the whitelist reaches Prisma", () => {
    const error = (raw: unknown) => listFiltersError(COLUMNS, raw);

    it.each([
      ["not an array", { field: "name" }],
      ["an unknown field", [{ field: "password", op: "contains", value: "a" }]],
      ["a prototype key", [{ field: "__proto__", op: "contains", value: "a" }]],
      [
        "a prototype key (constructor)",
        [{ field: "constructor", op: "isEmpty" }],
      ],
      [
        "an operator of another kind",
        [{ field: "name", op: "lt", value: "a" }],
      ],
      ["an unknown operator", [{ field: "name", op: "regex", value: ".*" }]],
      [
        "an extra property",
        [{ field: "name", op: "contains", value: "a", raw: "x" }],
      ],
      ["a blank text", [{ field: "name", op: "contains", value: "  " }]],
      [
        "a too long text",
        [{ field: "name", op: "contains", value: "a".repeat(101) }],
      ],
      [
        "a text that is not a string",
        [{ field: "name", op: "contains", value: { $ne: 1 } }],
      ],
      ["isEmpty on a required date", [{ field: "createdAt", op: "isEmpty" }]],
      ["a value on isEmpty", [{ field: "club", op: "isEmpty", value: "x" }]],
      [
        "an impossible date",
        [{ field: "createdAt", op: "eq", value: "2026-02-30" }],
      ],
      [
        "a date with a time",
        [{ field: "createdAt", op: "lt", value: "2026-10-14T00:00" }],
      ],
      [
        "reversed bounds",
        [
          {
            field: "createdAt",
            op: "between",
            value: ["2026-10-15", "2026-10-14"],
          },
        ],
      ],
      ["a single bound", [{ field: "bpm", op: "between", value: [1] }]],
      ["a number as text", [{ field: "bpm", op: "gt", value: "30" }]],
      [
        "an infinite number",
        [{ field: "bpm", op: "gt", value: Number.POSITIVE_INFINITY }],
      ],
      [
        "an unknown enum value",
        [{ field: "role", op: "in", value: ["SUPERADMIN"] }],
      ],
      ["an empty enum list", [{ field: "role", op: "in", value: [] }]],
      ["isEmpty on a required enum", [{ field: "role", op: "isEmpty" }]],
      [
        "too many filters",
        Array.from({ length: MAX_LIST_FILTERS + 1 }, () => ({
          field: "name",
          op: "isEmpty",
        })),
      ],
    ])("refuses %s", (_label, raw) => {
      expect(error(raw)).not.toBeNull();
    });

    it("accepts a valid list", () => {
      expect(
        error([
          { field: "name", op: "contains", value: "mar" },
          {
            field: "createdAt",
            op: "between",
            value: ["2026-01-01", "2026-12-31"],
          },
          { field: "role", op: "notIn", value: ["CLUB"] },
          { field: "club", op: "isNotEmpty" },
        ]),
      ).toBeNull();
    });

    it("refuses again when called without the validation pipe", () => {
      expect(() =>
        listFiltersWhere(COLUMNS, [
          { field: "password", op: "contains", value: "a" },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  it("offers « est vide » only where a value can be missing", () => {
    expect(allowedOps({ kind: "text", nullable: false })).toContain("isEmpty");
    expect(allowedOps({ kind: "date", nullable: false })).not.toContain(
      "isEmpty",
    );
    expect(allowedOps({ kind: "enum", nullable: true })).toEqual([
      "in",
      "notIn",
      "isEmpty",
    ]);
  });

  describe("query parameter", () => {
    it("parses the JSON and keeps a malformed one for the validator", () => {
      expect(
        parseListFiltersParam('[{"field":"name","op":"isEmpty"}]'),
      ).toEqual([{ field: "name", op: "isEmpty" }]);
      expect(parseListFiltersParam("[oops")).toBe("[oops");
      expect(parseListFiltersParam("")).toBeUndefined();
    });

    const errorsOf = async (filters: string) => {
      const dto = plainToInstance(ListAdminUsersQueryDto, { filters });
      return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    };

    it("is validated by the list DTO against its own whitelist", async () => {
      expect(
        await errorsOf(
          JSON.stringify([
            { field: "email", op: "contains", value: "@club.fr" },
            { field: "role", op: "in", value: ["CLUB"] },
            { field: "lastLoginAt", op: "isEmpty" },
          ]),
        ),
      ).toEqual([]);
      const errors = await errorsOf(
        JSON.stringify([{ field: "password", op: "contains", value: "a" }]),
      );
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
        "champ non filtrable",
      );
      expect(await errorsOf("not json")).toHaveLength(1);
    });
  });
});
