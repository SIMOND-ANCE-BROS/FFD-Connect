import {
  computePartnershipSuggestion,
  levelOrder,
  type PartnershipUserInput,
} from "./partnership-suggestion.util";

const makeUser = (
  overrides: Partial<PartnershipUserInput> = {},
): PartnershipUserInput => ({
  birthDate: new Date("1995-06-15"),
  category: null,
  competitionLevel: null,
  competitionLevelLatin: null,
  competitionLevelStandard: null,
  ...overrides,
});

describe("computePartnershipSuggestion", () => {
  const startDate = new Date("2024-01-01");

  it("adult couple without levels → lowest level allowed for the age class, both disciplines", () => {
    const result = computePartnershipSuggestion(
      makeUser(),
      makeUser(),
      startDate,
    );
    expect(result.coupleAgeGroup).toBe("Adulte");
    expect(result.suggestedLevelLatin).toBe("Intermédiaire");
    expect(result.suggestedLevelStandard).toBe("Intermédiaire");
    expect(result.suggestedLevel).toBe("Intermédiaire");
    expect(result.suggestedCategories).toEqual(["Latines", "Standards"]);
  });

  it("suggests a level PER DISCIPLINE (lower partner level in each)", () => {
    const u1 = makeUser({
      category: "Ten Dance",
      competitionLevelLatin: "International",
      competitionLevelStandard: "Avancé",
    });
    const u2 = makeUser({
      category: "Ten Dance",
      competitionLevelLatin: "International",
      competitionLevelStandard: "Intermédiaire",
    });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedLevelLatin).toBe("International");
    expect(result.suggestedLevelStandard).toBe("Intermédiaire");
    // Deprecated single value: the lower of the two.
    expect(result.suggestedLevel).toBe("Intermédiaire");
    expect(result.suggestedCategories).toEqual([
      "Latines",
      "Standards",
      "10 danses",
    ]);
  });

  it("never uses the Passeport Danse to cap the level", () => {
    const u = makeUser({
      competitionLevelLatin: "International",
      passportLevelLatin: "BLANC",
    } as Partial<PartnershipUserInput>);
    const result = computePartnershipSuggestion(u, u, startDate);
    expect(result.suggestedLevelLatin).toBe("International");
  });

  it("falls back to the legacy single level", () => {
    const u = makeUser({ competitionLevel: "Avancé" });
    const result = computePartnershipSuggestion(u, u, startDate);
    expect(result.suggestedLevelLatin).toBe("Avancé");
    expect(result.suggestedLevelStandard).toBe("Avancé");
  });

  it("Latin-only couple → no Standard suggestion", () => {
    const u = makeUser({ category: "Latin", competitionLevelLatin: "Avancé" });
    const result = computePartnershipSuggestion(u, u, startDate);
    expect(result.suggestedLevelLatin).toBe("Avancé");
    expect(result.suggestedLevelStandard).toBeNull();
    expect(result.suggestedLevel).toBe("Avancé");
    expect(result.suggestedCategories).toEqual(["Latines"]);
  });

  it("Standard-only couple", () => {
    const u = makeUser({ category: "Standard" });
    const result = computePartnershipSuggestion(u, u, startDate);
    expect(result.suggestedLevelLatin).toBeNull();
    expect(result.suggestedCategories).toEqual(["Standards"]);
  });

  it("partners without a common discipline → both disciplines listed, no level", () => {
    const result = computePartnershipSuggestion(
      makeUser({ category: "Latin" }),
      makeUser({ category: "Standard" }),
      startDate,
    );
    expect(result.suggestedLevel).toBeNull();
    expect(result.suggestedCategories).toEqual(["Latines", "Standards"]);
  });

  it("caps the suggestion with the age class (Junior I max Intermédiaire)", () => {
    const junior = makeUser({
      birthDate: new Date("2011-06-01"),
      competitionLevelLatin: "International",
    });
    const result = computePartnershipSuggestion(junior, junior, startDate);
    expect(result.coupleAgeGroup).toBe("Junior I");
    expect(result.suggestedLevelLatin).toBe("Intermédiaire");
  });

  it("returns null coupleAgeGroup and no level when a birth date is missing", () => {
    const result = computePartnershipSuggestion(
      makeUser({ birthDate: null }),
      makeUser(),
      startDate,
    );
    expect(result.coupleAgeGroup).toBeNull();
    expect(result.suggestedLevel).toBeNull();
    expect(result.suggestedLevelLatin).toBeNull();
  });
});

describe("levelOrder", () => {
  it("ranks known levels and puts unknown ones last", () => {
    expect(levelOrder("Débutant")).toBe(0);
    expect(levelOrder("International")).toBe(3);
    expect(levelOrder(null)).toBe(999);
  });
});
