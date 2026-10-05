import {
  getAllowedCoupleAgeClassesForEvent,
  getAllowedSoloAgeClassesForEvent,
  isAgeGroupEligibleForEvent,
  isLevelEligibleForClassificatriceEvent,
  checkParticipationEligibility,
  getAllowedEventKindsForCompetitionType,
  isEventKindAllowedForCompetitionType,
  isLevelAllowedForProximiteClassificatrice,
} from "./participation-rules.util";

// ---------------------------------------------------------------------------
// getAllowedCoupleAgeClassesForEvent
// ---------------------------------------------------------------------------
describe("getAllowedCoupleAgeClassesForEvent", () => {
  it("always includes own age group", () => {
    const result = getAllowedCoupleAgeClassesForEvent(
      "Adulte",
      "Adulte",
      "LATIN",
    );
    expect(result).toContain("Adulte");
  });

  it("Juvénile I can also dance in Juvénile II", () => {
    const result = getAllowedCoupleAgeClassesForEvent("Juvénile I", "", "");
    expect(result).toContain("Juvénile I");
    expect(result).toContain("Juvénile II");
  });

  it("Junior I can also dance in Junior II", () => {
    const result = getAllowedCoupleAgeClassesForEvent("Junior I", "", "");
    expect(result).toContain("Junior II");
  });

  it("Senior V can dance in Senior IV for LATINES", () => {
    const result = getAllowedCoupleAgeClassesForEvent(
      "Senior V",
      "",
      "latines",
    );
    expect(result).toContain("Senior IV");
  });

  it("Senior V in Standard should NOT include Senior IV (category restriction)", () => {
    const result = getAllowedCoupleAgeClassesForEvent(
      "Senior V",
      "",
      "standard",
    );
    expect(result).not.toContain("Senior IV");
  });

  it("Senior V can dance in Senior IV for ten dance", () => {
    const result = getAllowedCoupleAgeClassesForEvent(
      "Senior V",
      "",
      "ten dance",
    );
    expect(result).toContain("Senior IV");
  });

  it("upward choice: Junior II can dance in Youth", () => {
    const result = getAllowedCoupleAgeClassesForEvent("Junior II", "", "");
    expect(result).toContain("Youth");
  });

  it("upward choice: Senior II can dance in Senior I", () => {
    const result = getAllowedCoupleAgeClassesForEvent("Senior II", "", "");
    expect(result).toContain("Senior I");
  });
});

// ---------------------------------------------------------------------------
// getAllowedSoloAgeClassesForEvent
// ---------------------------------------------------------------------------
describe("getAllowedSoloAgeClassesForEvent", () => {
  it("always includes own class", () => {
    const result = getAllowedSoloAgeClassesForEvent("Solo Adulte", "");
    expect(result).toContain("Solo Adulte");
  });

  it("Solo Junior 2 can choose Solo Youth", () => {
    const result = getAllowedSoloAgeClassesForEvent("Solo Junior 2", "");
    expect(result).toContain("Solo Youth");
  });

  it("Solo Youth can choose Solo Adulte", () => {
    const result = getAllowedSoloAgeClassesForEvent("Solo Youth", "");
    expect(result).toContain("Solo Adulte");
  });

  it("Solo Senior can choose Solo Adulte", () => {
    const result = getAllowedSoloAgeClassesForEvent("Solo Senior", "");
    expect(result).toContain("Solo Adulte");
  });

  it("Solo Juvénile has no upward choice", () => {
    const result = getAllowedSoloAgeClassesForEvent("Solo Juvénile", "");
    expect(result).toEqual(["Solo Juvénile"]);
  });
});

// ---------------------------------------------------------------------------
// isAgeGroupEligibleForEvent
// ---------------------------------------------------------------------------
describe("isAgeGroupEligibleForEvent", () => {
  it("returns not allowed when registrantAgeGroup is empty", () => {
    const result = isAgeGroupEligibleForEvent("COUPLE", "", "Adulte");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/manquante/i);
  });

  it("returns not allowed when eventAgeGroup is empty", () => {
    const result = isAgeGroupEligibleForEvent("COUPLE", "Adulte", "");
    expect(result.allowed).toBe(false);
  });

  it("COUPLE: allowed when same age group", () => {
    expect(
      isAgeGroupEligibleForEvent("COUPLE", "Adulte", "Adulte").allowed,
    ).toBe(true);
  });

  it("COUPLE: Juvénile I allowed in Juvénile II", () => {
    expect(
      isAgeGroupEligibleForEvent("COUPLE", "Juvénile I", "Juvénile II").allowed,
    ).toBe(true);
  });

  it("COUPLE: Adulte not allowed in Junior I", () => {
    const result = isAgeGroupEligibleForEvent("COUPLE", "Adulte", "Junior I");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/classe d'âge couple/i);
  });

  it("SOLO: allowed when same age group", () => {
    expect(
      isAgeGroupEligibleForEvent("SOLO", "Solo Adulte", "Solo Adulte").allowed,
    ).toBe(true);
  });

  it("SOLO: Solo Youth allowed in Solo Adulte (upward choice)", () => {
    expect(
      isAgeGroupEligibleForEvent("SOLO", "Solo Youth", "Solo Adulte").allowed,
    ).toBe(true);
  });

  it("SOLO: Solo Juvénile not allowed in Solo Senior", () => {
    const result = isAgeGroupEligibleForEvent(
      "SOLO",
      "Solo Juvénile",
      "Solo Senior",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/classe d'âge solo/i);
  });
});

// ---------------------------------------------------------------------------
// isLevelEligibleForClassificatriceEvent
// ---------------------------------------------------------------------------
describe("isLevelEligibleForClassificatriceEvent", () => {
  it("returns allowed when eventLevel is null", () => {
    expect(
      isLevelEligibleForClassificatriceEvent("COUPLE", "Adulte", "Avancé", null)
        .allowed,
    ).toBe(true);
  });

  it("returns allowed when eventLevel is empty string", () => {
    expect(
      isLevelEligibleForClassificatriceEvent("COUPLE", "Adulte", "Avancé", "")
        .allowed,
    ).toBe(true);
  });

  it("returns not allowed when registrantLevel is missing", () => {
    const result = isLevelEligibleForClassificatriceEvent(
      "COUPLE",
      "Adulte",
      null,
      "Avancé",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non renseigné/i);
  });

  it("returns not allowed for unknown age group (no allowed levels)", () => {
    const result = isLevelEligibleForClassificatriceEvent(
      "COUPLE",
      "Inconnu",
      "Avancé",
      "Avancé",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non définis/i);
  });

  it("returns not allowed when level not in allowed levels for age group", () => {
    // Juvénile I only allows Intermédiaire, Débutant — not Avancé
    const result = isLevelEligibleForClassificatriceEvent(
      "COUPLE",
      "Juvénile I",
      "Avancé",
      "Avancé",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/réservée au niveau/i);
  });

  it("returns not allowed when registrant level is below event level", () => {
    // Event is Avancé, registrant is Débutant
    const result = isLevelEligibleForClassificatriceEvent(
      "COUPLE",
      "Adulte",
      "Débutant",
      "Avancé",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/insuffisant/i);
  });

  it("returns allowed when registrant level equals event level", () => {
    expect(
      isLevelEligibleForClassificatriceEvent(
        "COUPLE",
        "Adulte",
        "Avancé",
        "Avancé",
      ).allowed,
    ).toBe(true);
  });

  it("returns allowed when registrant level is above event level", () => {
    // International is above Avancé
    expect(
      isLevelEligibleForClassificatriceEvent(
        "COUPLE",
        "Adulte",
        "International",
        "Avancé",
      ).allowed,
    ).toBe(true);
  });

  it("SOLO: Solo Juvénile Intermédiaire is allowed in Intermédiaire event", () => {
    expect(
      isLevelEligibleForClassificatriceEvent(
        "SOLO",
        "Solo Juvénile",
        "Intermédiaire",
        "Intermédiaire",
      ).allowed,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkParticipationEligibility
// ---------------------------------------------------------------------------
describe("checkParticipationEligibility", () => {
  it("SOLO_TEAM always allowed", () => {
    expect(
      checkParticipationEligibility({
        eventType: "COUPLE",
        eventAgeGroup: "Adulte",
        eventKind: "SOLO_TEAM",
        registrantAgeGroup: "Junior I",
      }).allowed,
    ).toBe(true);
  });

  it("SHOW_DANSE always allowed", () => {
    expect(
      checkParticipationEligibility({
        eventType: "SOLO",
        eventAgeGroup: "Solo Senior",
        eventKind: "SHOW_DANSE",
        registrantAgeGroup: "Solo Juvénile",
      }).allowed,
    ).toBe(true);
  });

  it("fails age group check when not eligible", () => {
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Junior I",
      eventKind: "OPEN",
      registrantAgeGroup: "Senior V",
    });
    expect(result.allowed).toBe(false);
  });

  it("CLASSIFICATRICE: runs level check after age check", () => {
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Adulte",
      eventKind: "CLASSIFICATRICE",
      eventLevel: "Avancé",
      registrantAgeGroup: "Adulte",
      registrantLevel: "Débutant",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/insuffisant/i);
  });

  it("CLASSIFICATRICE: passes when level is sufficient", () => {
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Adulte",
      eventKind: "CLASSIFICATRICE",
      eventLevel: "Avancé",
      registrantAgeGroup: "Adulte",
      registrantLevel: "Avancé",
    });
    expect(result.allowed).toBe(true);
  });

  it("OPEN: fails when level not in allowed levels for age group", () => {
    // Juvénile I only has Intermédiaire, Débutant — not Avancé
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Juvénile I",
      eventKind: "OPEN",
      eventLevel: "Avancé",
      registrantAgeGroup: "Juvénile I",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/classe d'âge ne permet pas le niveau/i);
  });

  it("OPEN: passes when eventLevel is empty", () => {
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Adulte",
      eventKind: "OPEN",
      eventLevel: "",
      registrantAgeGroup: "Adulte",
    });
    expect(result.allowed).toBe(true);
  });

  it("MAJEURE (no OPEN/CLASSIFICATRICE): passes age check and returns allowed", () => {
    const result = checkParticipationEligibility({
      eventType: "COUPLE",
      eventAgeGroup: "Adulte",
      eventKind: "MAJEURE",
      registrantAgeGroup: "Adulte",
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllowedEventKindsForCompetitionType
// ---------------------------------------------------------------------------
describe("getAllowedEventKindsForCompetitionType", () => {
  it("PROXIMITE does not include MAJEURE", () => {
    const kinds = getAllowedEventKindsForCompetitionType("PROXIMITE");
    expect(kinds).not.toContain("MAJEURE");
  });

  it("NATIONALE includes all event kinds", () => {
    const kinds = getAllowedEventKindsForCompetitionType("NATIONALE");
    expect(kinds).toContain("CLASSIFICATRICE");
    expect(kinds).toContain("OPEN");
    expect(kinds).toContain("MAJEURE");
    expect(kinds).toContain("SOLO_TEAM");
    expect(kinds).toContain("SHOW_DANSE");
  });
});

// ---------------------------------------------------------------------------
// isEventKindAllowedForCompetitionType
// ---------------------------------------------------------------------------
describe("isEventKindAllowedForCompetitionType", () => {
  it("PROXIMITE + CLASSIFICATRICE → true", () => {
    expect(
      isEventKindAllowedForCompetitionType("PROXIMITE", "CLASSIFICATRICE"),
    ).toBe(true);
  });

  it("PROXIMITE + MAJEURE → false", () => {
    expect(isEventKindAllowedForCompetitionType("PROXIMITE", "MAJEURE")).toBe(
      false,
    );
  });

  it("INTERNATIONALE + MAJEURE → true", () => {
    expect(
      isEventKindAllowedForCompetitionType("INTERNATIONALE", "MAJEURE"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLevelAllowedForProximiteClassificatrice
// ---------------------------------------------------------------------------
describe("isLevelAllowedForProximiteClassificatrice", () => {
  it("returns true when level is null", () => {
    expect(isLevelAllowedForProximiteClassificatrice(null)).toBe(true);
  });

  it("returns true when level is empty", () => {
    expect(isLevelAllowedForProximiteClassificatrice("")).toBe(true);
  });

  it("Débutant is allowed", () => {
    expect(isLevelAllowedForProximiteClassificatrice("Débutant")).toBe(true);
  });

  it("Intermédiaire is allowed", () => {
    expect(isLevelAllowedForProximiteClassificatrice("Intermédiaire")).toBe(
      true,
    );
  });

  it("Avancé is not allowed", () => {
    expect(isLevelAllowedForProximiteClassificatrice("Avancé")).toBe(false);
  });

  it("International is not allowed", () => {
    expect(isLevelAllowedForProximiteClassificatrice("International")).toBe(
      false,
    );
  });
});
