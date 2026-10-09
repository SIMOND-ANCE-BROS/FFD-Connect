import {
  COMPETITION_LEVEL_ORDER,
  competitionLevelRank,
  disciplineLabel,
  getCompetitionLevelForCategory,
  getHighestCompetitionLevel,
  mirrorLegacyCompetitionLevel,
  normalizeDiscipline,
  practisesDiscipline,
  toCompetitionLevel,
} from "./index";

describe("normalizeDiscipline", () => {
  it.each([
    ["Latin", "Latin"],
    [" latines ", "Latin"],
    ["Latine", "Latin"],
    ["STANDARD", "Standard"],
    ["Standards", "Standard"],
    ["Ten Dance", "Ten Dance"],
    ["ten  dances", "Ten Dance"],
    ["10 danses", "Ten Dance"],
    ["Dix danses", "Ten Dance"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDiscipline(input)).toBe(expected);
  });

  it("returns null for empty or unknown values", () => {
    expect(normalizeDiscipline(null)).toBeNull();
    expect(normalizeDiscipline(undefined)).toBeNull();
    expect(normalizeDiscipline("")).toBeNull();
    expect(normalizeDiscipline("Salsa")).toBeNull();
  });
});

describe("disciplineLabel", () => {
  it("translates stored values for user-facing text", () => {
    expect(disciplineLabel("Latin")).toBe("Latines");
    expect(disciplineLabel("Standard")).toBe("Standards");
    expect(disciplineLabel("Ten Dance")).toBe("10 danses");
  });

  it("returns unknown values trimmed, and empty for null", () => {
    expect(disciplineLabel(" Licence C ")).toBe("Licence C");
    expect(disciplineLabel(null)).toBe("");
    expect(disciplineLabel(undefined)).toBe("");
  });
});

describe("toCompetitionLevel / competitionLevelRank", () => {
  it("accepts the 4 levels only", () => {
    expect(toCompetitionLevel(" Avancé ")).toBe("Avancé");
    expect(toCompetitionLevel("Expert")).toBeNull();
    expect(toCompetitionLevel("")).toBeNull();
    expect(toCompetitionLevel(null)).toBeNull();
  });

  it("ranks from Débutant to International", () => {
    expect(COMPETITION_LEVEL_ORDER).toEqual([
      "Débutant",
      "Intermédiaire",
      "Avancé",
      "International",
    ]);
    expect(competitionLevelRank("Débutant")).toBe(0);
    expect(competitionLevelRank("International")).toBe(3);
    expect(competitionLevelRank("Expert")).toBe(-1);
    expect(competitionLevelRank(null)).toBe(-1);
  });
});

describe("getCompetitionLevelForCategory", () => {
  const dancer = {
    competitionLevelLatin: "International",
    competitionLevelStandard: "Débutant",
    competitionLevel: "Avancé",
  };

  it("reads the level of the event discipline", () => {
    expect(getCompetitionLevelForCategory(dancer, "Latin")).toBe(
      "International",
    );
    expect(getCompetitionLevelForCategory(dancer, "Latines")).toBe(
      "International",
    );
    expect(getCompetitionLevelForCategory(dancer, "Standard")).toBe("Débutant");
  });

  it("returns null for Ten Dance (no level requirement)", () => {
    expect(getCompetitionLevelForCategory(dancer, "Ten Dance")).toBeNull();
    expect(getCompetitionLevelForCategory(dancer, "10 danses")).toBeNull();
  });

  it("falls back to the deprecated single level", () => {
    const legacy = { competitionLevel: "Avancé" };
    expect(getCompetitionLevelForCategory(legacy, "Latin")).toBe("Avancé");
    expect(getCompetitionLevelForCategory(legacy, "Standard")).toBe("Avancé");
    expect(getCompetitionLevelForCategory(legacy, null)).toBe("Avancé");
    expect(getCompetitionLevelForCategory(legacy, "Ten Dance")).toBeNull();
  });

  it("ignores invalid stored values", () => {
    expect(
      getCompetitionLevelForCategory(
        { competitionLevelLatin: "Expert", competitionLevel: "Débutant" },
        "Latin",
      ),
    ).toBe("Débutant");
  });

  it("returns null without a profile", () => {
    expect(getCompetitionLevelForCategory(null, "Latin")).toBeNull();
    expect(getCompetitionLevelForCategory(undefined, "Latin")).toBeNull();
  });
});

describe("getHighestCompetitionLevel", () => {
  it("returns the highest level across disciplines and legacy", () => {
    expect(
      getHighestCompetitionLevel({
        competitionLevelLatin: "Intermédiaire",
        competitionLevelStandard: "Avancé",
        competitionLevel: "Débutant",
      }),
    ).toBe("Avancé");
    expect(getHighestCompetitionLevel({ competitionLevel: "Débutant" })).toBe(
      "Débutant",
    );
  });

  it("returns null when no level is known", () => {
    expect(getHighestCompetitionLevel({})).toBeNull();
    expect(getHighestCompetitionLevel(null)).toBeNull();
  });
});

describe("practisesDiscipline", () => {
  it("returns null without any discipline information", () => {
    expect(practisesDiscipline(null, "Latin")).toBeNull();
    expect(practisesDiscipline({}, "Latin")).toBeNull();
    // The legacy single level says nothing about the discipline.
    expect(
      practisesDiscipline({ competitionLevel: "Avancé" }, "Ten Dance"),
    ).toBeNull();
  });

  it("uses the declared discipline", () => {
    expect(practisesDiscipline({ category: "Latin" }, "Latin")).toBe(true);
    expect(practisesDiscipline({ category: "Latin" }, "Standard")).toBe(false);
    expect(practisesDiscipline({ category: "Standard" }, "Standard")).toBe(
      true,
    );
  });

  it("a Ten Dance dancer practises Latin, Standard and Ten Dance", () => {
    const tenDancer = { category: "Ten Dance" };
    expect(practisesDiscipline(tenDancer, "Latin")).toBe(true);
    expect(practisesDiscipline(tenDancer, "Standard")).toBe(true);
    expect(practisesDiscipline(tenDancer, "10 danses")).toBe(true);
  });

  it("a per-discipline level counts as practising that discipline", () => {
    const both = {
      category: "Latin",
      competitionLevelStandard: "Débutant",
    };
    expect(practisesDiscipline(both, "Standard")).toBe(true);
    expect(practisesDiscipline(both, "Ten Dance")).toBe(true);
    expect(
      practisesDiscipline(
        {
          competitionLevelLatin: "Avancé",
          competitionLevelStandard: "Débutant",
        },
        "Ten Dance",
      ),
    ).toBe(true);
  });

  it("Ten Dance needs both disciplines", () => {
    expect(practisesDiscipline({ category: "Latin" }, "Ten Dance")).toBe(false);
    expect(
      practisesDiscipline({ competitionLevelLatin: "Avancé" }, "Ten Dance"),
    ).toBe(false);
  });

  it("returns null for an unknown event discipline", () => {
    expect(practisesDiscipline({ category: "Latin" }, "Salsa")).toBeNull();
  });
});

describe("mirrorLegacyCompetitionLevel", () => {
  it("copies a legacy-only write to both disciplines", () => {
    expect(
      mirrorLegacyCompetitionLevel({ competitionLevel: "Avancé" }),
    ).toEqual({
      competitionLevel: "Avancé",
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: "Avancé",
    });
    expect(mirrorLegacyCompetitionLevel({ competitionLevel: null })).toEqual({
      competitionLevel: null,
      competitionLevelLatin: null,
      competitionLevelStandard: null,
    });
  });

  it("leaves per-discipline writes and absent fields untouched", () => {
    const perDiscipline = {
      competitionLevel: "Avancé",
      competitionLevelLatin: "Débutant",
    };
    expect(mirrorLegacyCompetitionLevel(perDiscipline)).toBe(perDiscipline);
    const standardOnly = {
      competitionLevel: "Avancé",
      competitionLevelStandard: null,
    };
    expect(mirrorLegacyCompetitionLevel(standardOnly)).toBe(standardOnly);
    const none = { firstName: "A" } as { competitionLevel?: string | null };
    expect(mirrorLegacyCompetitionLevel(none)).toBe(none);
  });
});
