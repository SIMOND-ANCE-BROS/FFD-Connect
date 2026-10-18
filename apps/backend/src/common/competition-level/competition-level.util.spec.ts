import {
  COMPETITION_LEVEL_ORDER,
  competitionLevelRank,
  deriveLegacyCompetitionLevel,
  disciplineLabel,
  getCompetitionLevelForCategory,
  getHighestCompetitionLevel,
  hasDisciplineLevel,
  legacyCompetitionLevelMirror,
  mirrorLegacyCompetitionLevel,
  normalizeDiscipline,
  practisedDiscipline,
  practisesDiscipline,
  toCompetitionLevel,
  withDerivedCompetitionLevel,
} from "./index";

describe("practisedDiscipline (#552)", () => {
  it("a declared single discipline wins over everything else", () => {
    expect(
      practisedDiscipline(
        {
          category: "Latin",
          competitionLevelLatin: "Avancé",
          competitionLevelStandard: "Débutant",
        },
        "Ten Dance",
      ),
    ).toBe("Latin");
    expect(practisedDiscipline({ category: "standards" }, "Ten Dance")).toBe(
      "Standard",
    );
  });

  it("a Latin-only level beats a Ten Dance placeholder (profile and licence)", () => {
    expect(
      practisedDiscipline(
        { category: "Ten Dance", competitionLevelLatin: "Intermédiaire" },
        "Ten Dance",
      ),
    ).toBe("Latin");
  });

  it("a Standard-only level gives Standard", () => {
    expect(
      practisedDiscipline(
        { category: null, competitionLevelStandard: "Débutant" },
        "Ten Dance",
      ),
    ).toBe("Standard");
  });

  it("Ten Dance only when both disciplines carry a level", () => {
    expect(
      practisedDiscipline({
        competitionLevelLatin: "Avancé",
        competitionLevelStandard: "Avancé",
      }),
    ).toBe("Ten Dance");
  });

  it("ignores unknown level values", () => {
    expect(
      practisedDiscipline(
        {
          competitionLevelLatin: "Avancé",
          competitionLevelStandard: "Champion",
        },
        "Ten Dance",
      ),
    ).toBe("Latin");
  });

  it("falls back to a declared Ten Dance, then to the licence category", () => {
    expect(practisedDiscipline({ category: "10 danses" }, "Latin")).toBe(
      "Ten Dance",
    );
    expect(practisedDiscipline({ category: null }, "Latines")).toBe("Latin");
    expect(practisedDiscipline(null, "Standard")).toBe("Standard");
  });

  it("ignores the legacy single level (no discipline information)", () => {
    expect(
      practisedDiscipline({ competitionLevel: "Avancé" }, "Standard"),
    ).toBe("Standard");
  });

  it("returns null when nothing is known", () => {
    expect(practisedDiscipline(undefined)).toBeNull();
    expect(practisedDiscipline({ category: "Loisir" }, "Loisir")).toBeNull();
  });
});

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

  it("ignores the legacy level once any discipline level is set (#239)", () => {
    // Latin cleared, Standard set: a stale legacy level must not resurface.
    const latinCleared = {
      competitionLevelLatin: null,
      competitionLevelStandard: "Débutant",
      competitionLevel: "Avancé",
    };
    expect(getCompetitionLevelForCategory(latinCleared, "Latin")).toBeNull();
    expect(getCompetitionLevelForCategory(latinCleared, "Standard")).toBe(
      "Débutant",
    );
  });

  it("uses the highest level for an unknown discipline", () => {
    expect(getCompetitionLevelForCategory(dancer, null)).toBe("International");
    expect(getCompetitionLevelForCategory(dancer, "Salsa")).toBe(
      "International",
    );
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

  it("ignores the legacy level once a discipline level is set (#239)", () => {
    expect(
      getHighestCompetitionLevel({
        competitionLevelLatin: "Débutant",
        competitionLevel: "International",
      }),
    ).toBe("Débutant");
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

describe("hasDisciplineLevel", () => {
  it("is true only with a valid per-discipline level", () => {
    expect(hasDisciplineLevel({ competitionLevelLatin: "Avancé" })).toBe(true);
    expect(hasDisciplineLevel({ competitionLevelStandard: " Débutant " })).toBe(
      true,
    );
    expect(hasDisciplineLevel({ competitionLevelLatin: "Expert" })).toBe(false);
    expect(hasDisciplineLevel({ competitionLevel: "Avancé" })).toBe(false);
    expect(hasDisciplineLevel(null)).toBe(false);
  });
});

describe("deriveLegacyCompetitionLevel / withDerivedCompetitionLevel (#239)", () => {
  it("derives the served single level from the per-discipline ones", () => {
    expect(
      deriveLegacyCompetitionLevel({
        competitionLevelLatin: "Avancé",
        competitionLevelStandard: "Débutant",
        competitionLevel: "Débutant",
      }),
    ).toBe("Avancé");
  });

  it("keeps the legacy value for a profile without discipline levels", () => {
    expect(deriveLegacyCompetitionLevel({ competitionLevel: "Avancé" })).toBe(
      "Avancé",
    );
    expect(deriveLegacyCompetitionLevel({})).toBeNull();
  });

  it("replaces the stale column value in a response record", () => {
    const record = {
      id: "u1",
      competitionLevelLatin: null,
      competitionLevelStandard: "Intermédiaire",
      competitionLevel: "International",
    };
    expect(withDerivedCompetitionLevel(record)).toEqual({
      ...record,
      competitionLevel: "Intermédiaire",
    });
    // The input is not mutated.
    expect(record.competitionLevel).toBe("International");
  });

  it("sets the field even when the record did not carry it", () => {
    expect(
      withDerivedCompetitionLevel({ competitionLevelLatin: "Débutant" }),
    ).toEqual({
      competitionLevelLatin: "Débutant",
      competitionLevel: "Débutant",
    });
  });
});

describe("mirrorLegacyCompetitionLevel", () => {
  it("copies a legacy-only write to both disciplines, without the legacy key", () => {
    expect(
      mirrorLegacyCompetitionLevel({ competitionLevel: "Avancé" }),
    ).toEqual({
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: "Avancé",
    });
    expect(mirrorLegacyCompetitionLevel({ competitionLevel: null })).toEqual({
      competitionLevelLatin: null,
      competitionLevelStandard: null,
    });
  });

  it("drops the legacy key next to per-discipline writes", () => {
    expect(
      mirrorLegacyCompetitionLevel({
        competitionLevel: "Avancé",
        competitionLevelLatin: "Débutant",
      }),
    ).toEqual({ competitionLevelLatin: "Débutant" });
    expect(
      mirrorLegacyCompetitionLevel({
        competitionLevel: "Avancé",
        competitionLevelStandard: null,
      }),
    ).toEqual({ competitionLevelStandard: null });
  });

  it("leaves a write without any level untouched", () => {
    const none = { firstName: "A" } as {
      firstName: string;
      competitionLevel?: string | null;
    };
    expect(mirrorLegacyCompetitionLevel(none)).toEqual({ firstName: "A" });
  });
});

describe("legacyCompetitionLevelMirror (#239 rollback mirror)", () => {
  it("is undefined when the write touches no discipline level", () => {
    expect(legacyCompetitionLevelMirror({})).toBeUndefined();
  });

  it("derives the highest level of the resulting profile", () => {
    expect(
      legacyCompetitionLevelMirror({
        competitionLevelLatin: "International",
        competitionLevelStandard: "Débutant",
      }),
    ).toBe("International");
  });

  it("completes a partial write with the stored levels", () => {
    expect(
      legacyCompetitionLevelMirror(
        { competitionLevelLatin: "Débutant" },
        { competitionLevelLatin: "Avancé", competitionLevelStandard: "Avancé" },
      ),
    ).toBe("Avancé");
    expect(
      legacyCompetitionLevelMirror(
        { competitionLevelStandard: null },
        { competitionLevelLatin: null, competitionLevelStandard: "Avancé" },
      ),
    ).toBeNull();
  });

  it("is null when both levels end up cleared (no stale fallback)", () => {
    expect(
      legacyCompetitionLevelMirror({
        competitionLevelLatin: null,
        competitionLevelStandard: null,
      }),
    ).toBeNull();
  });
});
