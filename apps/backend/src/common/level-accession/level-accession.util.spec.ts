import {
  passportOrder,
  hasAtLeastPassport,
  getMaxLevelForCoupleAgeGroup,
  getAllowedLevelsForCouple,
} from "./level-accession.util";
import * as levelAccession from "./level-accession.util";

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

  it("is case-insensitive and trims", () => {
    expect(passportOrder("  orange ")).toBe(3);
  });

  it("returns -1 for null, undefined, empty, or unknown", () => {
    expect(passportOrder(null)).toBe(-1);
    expect(passportOrder(undefined)).toBe(-1);
    expect(passportOrder("")).toBe(-1);
    expect(passportOrder("   ")).toBe(-1);
    expect(passportOrder("INCONNU")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// hasAtLeastPassport (solo levels only)
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

  it("returns false for an unknown minimum colour", () => {
    expect(
      hasAtLeastPassport(
        "NOIR",
        "NOIR",
        "INCONNU" as unknown as levelAccession.PassportLevelValue,
      ),
    ).toBe(false);
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
// getAllowedLevelsForCouple — age class only, never the passport
// ---------------------------------------------------------------------------
describe("getAllowedLevelsForCouple", () => {
  it("returns empty array for null or unknown age group", () => {
    expect(getAllowedLevelsForCouple(null)).toEqual([]);
    expect(getAllowedLevelsForCouple(undefined)).toEqual([]);
    expect(getAllowedLevelsForCouple("Inconnu")).toEqual([]);
  });

  it("Juvénile I → [Intermédiaire, Débutant]", () => {
    expect(getAllowedLevelsForCouple("Juvénile I")).toEqual([
      "Intermédiaire",
      "Débutant",
    ]);
  });

  it("Adulte → [International, Avancé, Intermédiaire]", () => {
    expect(getAllowedLevelsForCouple("Adulte")).toEqual([
      "International",
      "Avancé",
      "Intermédiaire",
    ]);
  });

  it("Junior II → [Avancé, Intermédiaire, Débutant]", () => {
    expect(getAllowedLevelsForCouple("Junior II")).toEqual([
      "Avancé",
      "Intermédiaire",
      "Débutant",
    ]);
  });

  it("Junior I → age cap strips Avancé", () => {
    expect(getAllowedLevelsForCouple("Junior I")).toEqual([
      "Intermédiaire",
      "Débutant",
    ]);
  });

  it("Espoir has no cap entry: every allowed level is kept", () => {
    expect(getAllowedLevelsForCouple("Espoir")).toEqual([
      "International",
      "Avancé",
      "Intermédiaire",
    ]);
  });
});

// ---------------------------------------------------------------------------
// No coupling between competition level and Passeport Danse colours
// ---------------------------------------------------------------------------
describe("competition level is not derived from the Passeport Danse", () => {
  it("exposes no passport → competition level rule", () => {
    const exported = Object.keys(levelAccession);
    expect(exported).not.toContain("MIN_PASSPORT_FOR_LEVEL");
    expect(exported).not.toContain("coupleMeetsPassportForLevel");
    expect(exported).not.toContain("canAccessIntermediaire");
  });
});
