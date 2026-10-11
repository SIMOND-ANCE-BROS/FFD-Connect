import {
  competitionLevelRank,
  formatCompetitionLevels,
  formatSuggestedCoupleLevels,
  getCompetitionLevelForCategory,
  getHighestCompetitionLevel,
  normalizeDiscipline,
  practisesDiscipline,
  toCompetitionLevel,
} from "../competitionLevel";

describe("normalizeDiscipline", () => {
  it.each([
    ["Latin", "Latin"],
    ["latines", "Latin"],
    ["STANDARD", "Standard"],
    ["Standards", "Standard"],
    ["Ten Dance", "Ten Dance"],
    ["10 danses", "Ten Dance"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeDiscipline(raw)).toBe(expected);
  });

  it("returns null for unknown or empty values", () => {
    expect(normalizeDiscipline("Rock")).toBeNull();
    expect(normalizeDiscipline(null)).toBeNull();
    expect(normalizeDiscipline(undefined)).toBeNull();
  });
});

describe("toCompetitionLevel / competitionLevelRank", () => {
  it("accepts only the four FFD levels", () => {
    expect(toCompetitionLevel(" Avancé ")).toBe("Avancé");
    expect(toCompetitionLevel("JAUNE")).toBeNull();
    expect(toCompetitionLevel("")).toBeNull();
    expect(toCompetitionLevel(null)).toBeNull();
  });

  it("ranks levels from Débutant to International", () => {
    expect(competitionLevelRank("Débutant")).toBe(0);
    expect(competitionLevelRank("International")).toBe(3);
    expect(competitionLevelRank("bogus")).toBe(-1);
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
    expect(getCompetitionLevelForCategory(dancer, "Standard")).toBe("Débutant");
  });

  it("falls back to the legacy single level", () => {
    expect(
      getCompetitionLevelForCategory({ competitionLevel: "Avancé" }, "Latin"),
    ).toBe("Avancé");
    expect(getCompetitionLevelForCategory(dancer, "Rock")).toBe("Avancé");
  });

  it("has no level for Ten Dance", () => {
    expect(getCompetitionLevelForCategory(dancer, "Ten Dance")).toBeNull();
  });

  it("returns null without a profile", () => {
    expect(getCompetitionLevelForCategory(null, "Latin")).toBeNull();
  });
});

describe("getHighestCompetitionLevel", () => {
  it("takes the highest level across disciplines", () => {
    expect(
      getHighestCompetitionLevel({
        competitionLevelLatin: "Débutant",
        competitionLevelStandard: "Avancé",
      }),
    ).toBe("Avancé");
  });

  it("uses the legacy level when nothing else is set", () => {
    expect(
      getHighestCompetitionLevel({ competitionLevel: "Intermédiaire" }),
    ).toBe("Intermédiaire");
  });

  it("returns null when no level is known", () => {
    expect(getHighestCompetitionLevel({})).toBeNull();
    expect(getHighestCompetitionLevel(null)).toBeNull();
  });
});

describe("practisesDiscipline", () => {
  it("covers a discipline with a level in it", () => {
    const p = { competitionLevelStandard: "Débutant" };
    expect(practisesDiscipline(p, "Standard")).toBe(true);
    expect(practisesDiscipline(p, "Latin")).toBe(false);
  });

  it("covers a discipline from the declared category", () => {
    expect(practisesDiscipline({ category: "Latin" }, "Latin")).toBe(true);
    expect(practisesDiscipline({ category: "Latin" }, "Standard")).toBe(false);
  });

  it("requires both disciplines for Ten Dance", () => {
    expect(practisesDiscipline({ category: "Latin" }, "Ten Dance")).toBe(false);
    expect(
      practisesDiscipline(
        { category: "Latin", competitionLevelStandard: "Débutant" },
        "Ten Dance",
      ),
    ).toBe(true);
    expect(practisesDiscipline({ category: "Ten Dance" }, "Ten Dance")).toBe(
      true,
    );
  });

  it("returns null when nothing is known (not blocking)", () => {
    expect(practisesDiscipline({}, "Latin")).toBeNull();
    expect(practisesDiscipline(null, "Latin")).toBeNull();
    expect(practisesDiscipline({ category: "Latin" }, "Rock")).toBeNull();
  });
});

describe("formatCompetitionLevels", () => {
  it("lists each discipline level in French", () => {
    expect(
      formatCompetitionLevels({
        competitionLevelLatin: "Avancé",
        competitionLevelStandard: "Débutant",
      }),
    ).toBe("Latines : Avancé · Standards : Débutant");
  });

  it("shows only the disciplines that have a level", () => {
    expect(
      formatCompetitionLevels({
        competitionLevelLatin: null,
        competitionLevelStandard: "Débutant",
        competitionLevel: "Avancé",
      }),
    ).toBe("Standards : Débutant");
  });

  it("falls back to the legacy level, then null", () => {
    expect(formatCompetitionLevels({ competitionLevel: "Avancé" })).toBe(
      "Avancé",
    );
    expect(formatCompetitionLevels({ competitionLevel: " " })).toBeNull();
    expect(formatCompetitionLevels(undefined)).toBeNull();
  });
});

describe("formatSuggestedCoupleLevels", () => {
  it("shows one suggested level per discipline", () => {
    expect(
      formatSuggestedCoupleLevels({
        suggestedLevelLatin: "Intermédiaire",
        suggestedLevelStandard: "Débutant",
        suggestedLevel: "Débutant",
      }),
    ).toBe("Latines : Intermédiaire · Standards : Débutant");
  });

  it("falls back to the single suggested level of an older backend", () => {
    expect(formatSuggestedCoupleLevels({ suggestedLevel: "Avancé" })).toBe(
      "Avancé",
    );
  });

  it("shows a dash when nothing is suggested", () => {
    expect(
      formatSuggestedCoupleLevels({
        suggestedLevelLatin: null,
        suggestedLevelStandard: null,
        suggestedLevel: null,
      }),
    ).toBe("—");
  });
});
