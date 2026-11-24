import type { Prisma } from "@prisma/client";
import {
  deriveUserDisciplines,
  LEGACY_DISCIPLINE_FIELDS,
  syncUserDisciplines,
  touchesDisciplineFields,
} from "./user-disciplines.sync";

describe("deriveUserDisciplines (#1023)", () => {
  it.each([
    ["Latin", ["LATIN"]],
    [" latines ", ["LATIN"]],
    ["STANDARDS", ["STANDARD"]],
    ["Ten Dance", ["LATIN", "STANDARD", "TEN_DANCE"]],
    ["10  danses", ["LATIN", "STANDARD", "TEN_DANCE"]],
    ["dix danses", ["LATIN", "STANDARD", "TEN_DANCE"]],
  ])("maps the declared discipline %p to %p", (category, codes) => {
    expect(deriveUserDisciplines({ category }).map((r) => r.code)).toEqual(
      codes,
    );
  });

  it.each([null, undefined, "", "  ", "Adulte", "Rock"])(
    "declares nothing for the category %p",
    (category) => {
      expect(deriveUserDisciplines({ category })).toEqual([]);
    },
  );

  it("marks the declared discipline as primary, TEN_DANCE for 10 danses", () => {
    expect(deriveUserDisciplines({ category: "Standard" })).toEqual([
      {
        code: "STANDARD",
        passportLevel: null,
        competitionLevel: null,
        primary: true,
      },
    ]);
    expect(
      deriveUserDisciplines({ category: "Ten Dance" }).map((r) => [
        r.code,
        r.primary,
      ]),
    ).toEqual([
      ["LATIN", false],
      ["STANDARD", false],
      ["TEN_DANCE", true],
    ]);
  });

  it("copies each level to its discipline, none on TEN_DANCE", () => {
    expect(
      deriveUserDisciplines({
        category: "Ten Dance",
        passportLevelLatin: "VERT",
        passportLevelStandard: "BLEU",
        competitionLevelLatin: " Avancé ",
        competitionLevelStandard: "Débutant",
      }),
    ).toEqual([
      {
        code: "LATIN",
        passportLevel: "VERT",
        competitionLevel: "Avancé",
        primary: false,
      },
      {
        code: "STANDARD",
        passportLevel: "BLEU",
        competitionLevel: "Débutant",
        primary: false,
      },
      {
        code: "TEN_DANCE",
        passportLevel: null,
        competitionLevel: null,
        primary: true,
      },
    ]);
  });

  it("adds a discipline that only carries a level, not as primary", () => {
    expect(
      deriveUserDisciplines({
        category: "Latin",
        competitionLevelStandard: "International",
      }),
    ).toEqual([
      {
        code: "LATIN",
        passportLevel: null,
        competitionLevel: null,
        primary: true,
      },
      {
        code: "STANDARD",
        passportLevel: null,
        competitionLevel: "International",
        primary: false,
      },
    ]);
    expect(
      deriveUserDisciplines({ passportLevelLatin: "JAUNE" }).map((r) => [
        r.code,
        r.primary,
      ]),
    ).toEqual([["LATIN", false]]);
  });

  it("ignores a blank competition level", () => {
    expect(
      deriveUserDisciplines({
        competitionLevelLatin: "   ",
        competitionLevelStandard: "",
      }),
    ).toEqual([]);
  });
});

describe("touchesDisciplineFields (#1023)", () => {
  it.each(LEGACY_DISCIPLINE_FIELDS)("is true when %s is written", (field) => {
    expect(touchesDisciplineFields({ [field]: null })).toBe(true);
  });

  it("is false for other fields, absent values or no payload", () => {
    expect(touchesDisciplineFields({ lastName: "Durand" })).toBe(false);
    expect(touchesDisciplineFields({ category: undefined })).toBe(false);
    expect(touchesDisciplineFields(null)).toBe(false);
    // The deprecated single level is mirrored per discipline upstream.
    expect(touchesDisciplineFields({ competitionLevel: "Avancé" })).toBe(false);
  });
});

describe("syncUserDisciplines (#1023)", () => {
  const catalog = [
    { id: "d-latin", code: "LATIN" },
    { id: "d-standard", code: "STANDARD" },
    { id: "d-ten", code: "TEN_DANCE" },
  ];

  const txWith = (
    user: Record<string, unknown> | null,
    disciplines = catalog,
  ) => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      discipline: { findMany: jest.fn().mockResolvedValue(disciplines) },
      userDiscipline: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({ id: "ud" }),
      },
    };
    return { tx, client: tx as unknown as Prisma.TransactionClient };
  };

  it("upserts the derived rows and deletes the other sport dance ones", async () => {
    const { tx, client } = txWith({
      category: "Latin",
      passportLevelLatin: "VERT",
      passportLevelStandard: null,
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: null,
    });

    await syncUserDisciplines(client, "u1");

    expect(tx.discipline.findMany).toHaveBeenCalledWith({
      where: { code: { in: ["LATIN", "STANDARD", "TEN_DANCE"] } },
      select: { id: true, code: true },
      take: 3,
    });
    expect(tx.userDiscipline.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        disciplineId: {
          in: ["d-latin", "d-standard", "d-ten"],
          notIn: ["d-latin"],
        },
      },
    });
    const levels = {
      passportLevel: "VERT",
      competitionLevel: "Avancé",
      primary: true,
    };
    expect(tx.userDiscipline.upsert).toHaveBeenCalledTimes(1);
    expect(tx.userDiscipline.upsert).toHaveBeenCalledWith({
      where: { userId_disciplineId: { userId: "u1", disciplineId: "d-latin" } },
      create: { userId: "u1", disciplineId: "d-latin", ...levels },
      update: levels,
      select: { id: true },
    });
  });

  it("clears every sport dance row when nothing is declared any more", async () => {
    const { tx, client } = txWith({ category: null });

    await syncUserDisciplines(client, "u1");

    expect(tx.userDiscipline.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        disciplineId: {
          in: ["d-latin", "d-standard", "d-ten"],
          notIn: [],
        },
      },
    });
    expect(tx.userDiscipline.upsert).not.toHaveBeenCalled();
  });

  it("skips a code missing from the catalog", async () => {
    const { tx, client } = txWith({ category: "Ten Dance" }, [
      { id: "d-latin", code: "LATIN" },
    ]);

    await syncUserDisciplines(client, "u1");

    expect(tx.userDiscipline.upsert).toHaveBeenCalledTimes(1);
    expect(tx.userDiscipline.upsert.mock.calls[0][0].create.disciplineId).toBe(
      "d-latin",
    );
  });

  it("does nothing for an unknown user", async () => {
    const { tx, client } = txWith(null);

    await syncUserDisciplines(client, "ghost");

    expect(tx.discipline.findMany).not.toHaveBeenCalled();
    expect(tx.userDiscipline.deleteMany).not.toHaveBeenCalled();
    expect(tx.userDiscipline.upsert).not.toHaveBeenCalled();
  });
});
