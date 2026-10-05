import {
  passportOrder,
  hasAtLeastPassport,
  coupleMeetsPassportForLevel,
  getMaxLevelForCoupleAgeGroup,
  getAllowedLevelsForCouple,
  canAccessIntermediaire,
  meetsPassportForAvance,
  meetsPassportForInternational,
} from "./level-accession.util";

// ---------------------------------------------------------------------------
// passportOrder
// ---------------------------------------------------------------------------
describe("passportOrder", () => {
  it("returns correct index for each passport color in order", () => {
    expect(passportOrder("BLANC")).toBe(0);
    expect(passportOrder("BEIGE")).toBe(1);
    expect(passportOrder("JAUNE")).toBe(2);
    expect(passportOrder("ORANGE")).toBe(3);
    expect(passportOrder("VERT")).toBe(4);
    expect(passportOrder("VIOLET")).toBe(5);
    expect(passportOrder("BLEU")).toBe(6);
    expect(passportOrder("ROUGE")).toBe(7);
    expect(passportOrder("NOIR")).toBe(8);
  });

  it("returns -1 for null, undefined, empty, or unknown", () => {
    expect(passportOrder(null)).toBe(-1);
    expect(passportOrder(undefined)).toBe(-1);
    expect(passportOrder("")).toBe(-1);
    expect(passportOrder("INCONNU")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// hasAtLeastPassport
// ---------------------------------------------------------------------------
describe("hasAtLeastPassport", () => {
  it("uses the best of Latin and Standard passports", () => {
    expect(hasAtLeastPassport("ORANGE", "BLANC", "ORANGE")).toBe(true);
    expect(hasAtLeastPassport("BLANC", "ORANGE", "ORANGE")).toBe(true);
  });

  it("returns false when both are below minimum", () => {
    expect(hasAtLeastPassport("BLANC", "BEIGE", "ORANGE")).toBe(false);
  });

  it("returns true when passport is above minimum", () => {
    expect(hasAtLeastPassport("ROUGE", null, "ORANGE")).toBe(true);
  });

  it("returns false when both are null", () => {
    expect(hasAtLeastPassport(null, null, "ORANGE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coupleMeetsPassportForLevel
// ---------------------------------------------------------------------------
describe("coupleMeetsPassportForLevel", () => {
  const pOrange = { passportLevelLatin: "ORANGE", passportLevelStandard: null };
  const pViolet = { passportLevelLatin: "VIOLET", passportLevelStandard: null };
  const pRouge = { passportLevelLatin: "ROUGE", passportLevelStandard: null };
  const pBlanc = { passportLevelLatin: "BLANC", passportLevelStandard: null };

  it("Débutant always returns true — no passport requirement", () => {
    expect(coupleMeetsPassportForLevel(pBlanc, pBlanc, "Débutant")).toBe(true);
    expect(
      coupleMeetsPassportForLevel(
        { passportLevelLatin: null, passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: null },
        "Débutant",
      ),
    ).toBe(true);
  });

  it("Intermédiaire requires ORANGE for both partners", () => {
    expect(coupleMeetsPassportForLevel(pOrange, pOrange, "Intermédiaire")).toBe(
      true,
    );
    expect(coupleMeetsPassportForLevel(pOrange, pBlanc, "Intermédiaire")).toBe(
      false,
    );
    expect(coupleMeetsPassportForLevel(pBlanc, pOrange, "Intermédiaire")).toBe(
      false,
    );
  });

  it("Avancé requires VIOLET for both partners", () => {
    expect(coupleMeetsPassportForLevel(pViolet, pViolet, "Avancé")).toBe(true);
    expect(coupleMeetsPassportForLevel(pOrange, pViolet, "Avancé")).toBe(false);
  });

  it("International requires ROUGE for both partners", () => {
    expect(coupleMeetsPassportForLevel(pRouge, pRouge, "International")).toBe(
      true,
    );
    expect(coupleMeetsPassportForLevel(pViolet, pRouge, "International")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// getMaxLevelForCoupleAgeGroup
// ---------------------------------------------------------------------------
describe("getMaxLevelForCoupleAgeGroup", () => {
  it("Juvénile I, Juvénile II, and Junior I cap at Intermédiaire", () => {
    expect(getMaxLevelForCoupleAgeGroup("Juvénile I")).toBe("Intermédiaire");
    expect(getMaxLevelForCoupleAgeGroup("Juvénile II")).toBe("Intermédiaire");
    expect(getMaxLevelForCoupleAgeGroup("Junior I")).toBe("Intermédiaire");
  });

  it("Junior II and Youth cap at Avancé", () => {
    expect(getMaxLevelForCoupleAgeGroup("Junior II")).toBe("Avancé");
    expect(getMaxLevelForCoupleAgeGroup("Youth")).toBe("Avancé");
  });

  it("Adulte and all Seniors cap at International", () => {
    for (const ag of [
      "Adulte",
      "Senior I",
      "Senior II",
      "Senior III",
      "Senior IV",
      "Senior V",
    ]) {
      expect(getMaxLevelForCoupleAgeGroup(ag)).toBe("International");
    }
  });

  it("returns null for null, undefined, empty, or unknown", () => {
    expect(getMaxLevelForCoupleAgeGroup(null)).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup(undefined)).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup("")).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup("Inconnu")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllowedLevelsForCouple
// ---------------------------------------------------------------------------
describe("getAllowedLevelsForCouple", () => {
  const bothRouge = {
    passportLevelLatin: "ROUGE",
    passportLevelStandard: "ROUGE",
  };
  const bothOrange = {
    passportLevelLatin: "ORANGE",
    passportLevelStandard: null,
  };
  const bothBlanc = {
    passportLevelLatin: "BLANC",
    passportLevelStandard: null,
  };
  const bothViolet = {
    passportLevelLatin: "VIOLET",
    passportLevelStandard: null,
  };

  it("returns empty array for null or unknown age group", () => {
    expect(getAllowedLevelsForCouple(null, bothRouge, bothRouge)).toEqual([]);
    expect(getAllowedLevelsForCouple("Inconnu", bothRouge, bothRouge)).toEqual(
      [],
    );
  });

  it("Juvénile I with ORANGE passports → [Intermédiaire, Débutant]", () => {
    const result = getAllowedLevelsForCouple(
      "Juvénile I",
      bothOrange,
      bothOrange,
    );
    expect(result).toEqual(["Intermédiaire", "Débutant"]);
  });

  it("Juvénile I with BLANC passports → [Débutant] only", () => {
    const result = getAllowedLevelsForCouple(
      "Juvénile I",
      bothBlanc,
      bothBlanc,
    );
    expect(result).toEqual(["Débutant"]);
  });

  it("Adulte with ROUGE passports → [International, Avancé, Intermédiaire]", () => {
    const result = getAllowedLevelsForCouple("Adulte", bothRouge, bothRouge);
    expect(result).toEqual(["International", "Avancé", "Intermédiaire"]);
  });

  it("Adulte with ORANGE passports → [Intermédiaire] only", () => {
    const result = getAllowedLevelsForCouple("Adulte", bothOrange, bothOrange);
    expect(result).toEqual(["Intermédiaire"]);
  });

  it("Junior II with VIOLET passports → [Avancé, Intermédiaire, Débutant]", () => {
    const result = getAllowedLevelsForCouple(
      "Junior II",
      bothViolet,
      bothViolet,
    );
    expect(result).toEqual(["Avancé", "Intermédiaire", "Débutant"]);
  });

  it("Junior I with VIOLET passports → [Intermédiaire, Débutant] (age cap strips Avancé)", () => {
    const result = getAllowedLevelsForCouple(
      "Junior I",
      bothViolet,
      bothViolet,
    );
    expect(result).toEqual(["Intermédiaire", "Débutant"]);
  });

  it("one partner below passport requirement filters out that level", () => {
    const p1 = { passportLevelLatin: "VIOLET", passportLevelStandard: null };
    const p2 = { passportLevelLatin: "ORANGE", passportLevelStandard: null };
    const result = getAllowedLevelsForCouple("Adulte", p1, p2);
    expect(result).toEqual(["Intermédiaire"]);
  });
});

// ---------------------------------------------------------------------------
// Shorthand wrappers
// ---------------------------------------------------------------------------
describe("canAccessIntermediaire", () => {
  it("returns true when both partners have at least ORANGE", () => {
    expect(
      canAccessIntermediaire(
        { passportLevelLatin: "ORANGE", passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: "VERT" },
      ),
    ).toBe(true);
  });

  it("returns false when one partner is below ORANGE", () => {
    expect(
      canAccessIntermediaire(
        { passportLevelLatin: "ORANGE", passportLevelStandard: null },
        { passportLevelLatin: "JAUNE", passportLevelStandard: "BEIGE" },
      ),
    ).toBe(false);
  });
});

describe("meetsPassportForAvance", () => {
  it("returns true when both partners have at least VIOLET", () => {
    expect(
      meetsPassportForAvance(
        { passportLevelLatin: "VIOLET", passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: "BLEU" },
      ),
    ).toBe(true);
  });

  it("returns false when one partner is below VIOLET", () => {
    expect(
      meetsPassportForAvance(
        { passportLevelLatin: "VIOLET", passportLevelStandard: null },
        { passportLevelLatin: "ORANGE", passportLevelStandard: null },
      ),
    ).toBe(false);
  });
});

describe("meetsPassportForInternational", () => {
  it("returns true when both partners have at least ROUGE", () => {
    expect(
      meetsPassportForInternational(
        { passportLevelLatin: "ROUGE", passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: "NOIR" },
      ),
    ).toBe(true);
  });

  it("returns false when one partner is below ROUGE", () => {
    expect(
      meetsPassportForInternational(
        { passportLevelLatin: "ROUGE", passportLevelStandard: null },
        { passportLevelLatin: "VIOLET", passportLevelStandard: null },
      ),
    ).toBe(false);
  });
});
