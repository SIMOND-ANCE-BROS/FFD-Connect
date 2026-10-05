import {
  getSoloRegroupementFromAgeGroup,
  computeSoloAgeRegroupement,
  soloMeetsPassportForLevel,
  meetsPassportForSoloConfirmé,
  meetsPassportForSoloExperimente,
  getSoloDancesForLevelAndCategory,
  DANCE_COUNT_BY_SOLO_LEVEL,
  SOLO_LATINES_DANCES_BY_LEVEL,
  SOLO_STANDARDS_DANCES_BY_LEVEL,
} from "./solo-rules.util";

// ---------------------------------------------------------------------------
// getSoloRegroupementFromAgeGroup
// ---------------------------------------------------------------------------
describe("getSoloRegroupementFromAgeGroup", () => {
  it.each([
    ["Solo Juvénile", "Moins de 14 ans"],
    ["Solo Junior 1", "Moins de 14 ans"],
    ["Solo Junior 2", "Moins de 19 ans"],
    ["Solo Youth", "Moins de 19 ans"],
    ["Solo Adulte", "Moins de 30 ans"],
    ["Solo Senior", "30 ans et Plus"],
  ])("%s → %s", (ageGroup, expected) => {
    expect(getSoloRegroupementFromAgeGroup(ageGroup)).toBe(expected);
  });

  it("returns null for null input", () => {
    expect(getSoloRegroupementFromAgeGroup(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getSoloRegroupementFromAgeGroup("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(getSoloRegroupementFromAgeGroup("   ")).toBeNull();
  });

  it("returns null/undefined for unknown age group", () => {
    expect(getSoloRegroupementFromAgeGroup("Inconnu")).toBeFalsy();
  });

  it("handles leading/trailing whitespace", () => {
    expect(getSoloRegroupementFromAgeGroup("  Solo Senior  ")).toBe(
      "30 ans et Plus",
    );
  });
});

// ---------------------------------------------------------------------------
// computeSoloAgeRegroupement
// ---------------------------------------------------------------------------
describe("computeSoloAgeRegroupement", () => {
  const year = 2024;

  it("returns null when birthDate is null", () => {
    expect(computeSoloAgeRegroupement(null, year)).toBeNull();
  });

  it("returns null when birthDate is undefined", () => {
    expect(computeSoloAgeRegroupement(undefined, year)).toBeNull();
  });

  // Age is computed at 31/12 of referenceYear
  it("returns 'Moins de 14 ans' for age 13", () => {
    // born 2011 → age at 31/12/2024 = 13
    const birth = new Date(2011, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("Moins de 14 ans");
  });

  it("returns 'Moins de 19 ans' for age 14", () => {
    // born 2010 → age 14
    const birth = new Date(2010, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("Moins de 19 ans");
  });

  it("returns 'Moins de 19 ans' for age 18", () => {
    const birth = new Date(2006, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("Moins de 19 ans");
  });

  it("returns 'Moins de 30 ans' for age 19", () => {
    const birth = new Date(2005, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("Moins de 30 ans");
  });

  it("returns 'Moins de 30 ans' for age 29", () => {
    const birth = new Date(1995, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("Moins de 30 ans");
  });

  it("returns '30 ans et Plus' for age 30", () => {
    const birth = new Date(1994, 6, 15);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("30 ans et Plus");
  });

  it("returns '30 ans et Plus' for age 60", () => {
    const birth = new Date(1964, 0, 1);
    expect(computeSoloAgeRegroupement(birth, year)).toBe("30 ans et Plus");
  });
});

// ---------------------------------------------------------------------------
// soloMeetsPassportForLevel
// ---------------------------------------------------------------------------
describe("soloMeetsPassportForLevel", () => {
  it("Novice: always allowed regardless of passport", () => {
    expect(soloMeetsPassportForLevel(null, null, "Novice")).toBe(true);
    expect(soloMeetsPassportForLevel("BLANC", null, "Novice")).toBe(true);
  });

  it("Confirmé: requires at least ORANGE passport (latin or standard)", () => {
    expect(soloMeetsPassportForLevel("ORANGE", null, "Confirmé")).toBe(true);
    expect(soloMeetsPassportForLevel(null, "ORANGE", "Confirmé")).toBe(true);
    expect(soloMeetsPassportForLevel("BLANC", "BLANC", "Confirmé")).toBe(false);
    expect(soloMeetsPassportForLevel(null, null, "Confirmé")).toBe(false);
  });

  it("Expérimenté: requires at least VERT passport", () => {
    expect(soloMeetsPassportForLevel("VERT", null, "Expérimenté")).toBe(true);
    expect(soloMeetsPassportForLevel(null, "VERT", "Expérimenté")).toBe(true);
    expect(soloMeetsPassportForLevel("ORANGE", null, "Expérimenté")).toBe(
      false,
    );
    expect(soloMeetsPassportForLevel(null, null, "Expérimenté")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// meetsPassportForSoloConfirmé / meetsPassportForSoloExperimente
// ---------------------------------------------------------------------------
describe("meetsPassportForSoloConfirmé", () => {
  it("returns true when at least one passport is ORANGE", () => {
    expect(meetsPassportForSoloConfirmé("ORANGE", null)).toBe(true);
  });

  it("returns false when no passport meets ORANGE", () => {
    expect(meetsPassportForSoloConfirmé("BLANC", "BLANC")).toBe(false);
  });
});

describe("meetsPassportForSoloExperimente", () => {
  it("returns true when at least one passport is VERT", () => {
    expect(meetsPassportForSoloExperimente(null, "VERT")).toBe(true);
  });

  it("returns false when only ORANGE", () => {
    expect(meetsPassportForSoloExperimente("ORANGE", "ORANGE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSoloDancesForLevelAndCategory
// ---------------------------------------------------------------------------
describe("getSoloDancesForLevelAndCategory", () => {
  it.each(["LATINE", "LATINES"] as const)(
    "returns latin dances for category %s",
    (cat) => {
      expect(getSoloDancesForLevelAndCategory("Novice", cat)).toEqual([
        ...SOLO_LATINES_DANCES_BY_LEVEL["Novice"],
      ]);
    },
  );

  it.each(["STANDARD", "STANDARDS"] as const)(
    "returns standard dances for category %s",
    (cat) => {
      expect(getSoloDancesForLevelAndCategory("Confirmé", cat)).toEqual([
        ...SOLO_STANDARDS_DANCES_BY_LEVEL["Confirmé"],
      ]);
    },
  );

  it("returns correct dance count per level", () => {
    expect(getSoloDancesForLevelAndCategory("Novice", "LATINE")).toHaveLength(
      DANCE_COUNT_BY_SOLO_LEVEL["Novice"],
    );
    expect(getSoloDancesForLevelAndCategory("Confirmé", "LATINE")).toHaveLength(
      DANCE_COUNT_BY_SOLO_LEVEL["Confirmé"],
    );
    expect(
      getSoloDancesForLevelAndCategory("Expérimenté", "LATINE"),
    ).toHaveLength(DANCE_COUNT_BY_SOLO_LEVEL["Expérimenté"]);
  });

  it("returns a copy (not a reference to the original array)", () => {
    const dances = getSoloDancesForLevelAndCategory("Novice", "LATINE");
    dances.push("extra");
    expect(SOLO_LATINES_DANCES_BY_LEVEL["Novice"]).toHaveLength(3);
  });

  it("Expérimenté latines contains Paso Doble and Samba", () => {
    const dances = getSoloDancesForLevelAndCategory("Expérimenté", "LATINE");
    expect(dances).toContain("Paso Doble");
    expect(dances).toContain("Samba");
  });

  it("Expérimenté standards contains Slowfox", () => {
    const dances = getSoloDancesForLevelAndCategory("Expérimenté", "STANDARD");
    expect(dances).toContain("Slowfox");
  });
});
