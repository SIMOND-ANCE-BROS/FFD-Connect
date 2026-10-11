import {
  enrichCompetitionsForUser,
  evaluateEventEligibility,
  mapEventsWithEligibility,
  type EligibilityEventInput,
  type EligibilityProfile,
} from "./competition-query.utils";

const event = (
  overrides: Partial<EligibilityEventInput> = {},
): EligibilityEventInput => ({
  eventType: "COUPLE",
  ageGroup: "Adulte",
  category: "Latin",
  level: null,
  eventKind: null,
  ...overrides,
});

const profile = (
  overrides: Partial<EligibilityProfile> = {},
): EligibilityProfile => ({
  ageGroup: "Adulte",
  category: "Latin",
  competitionLevel: null,
  competitionLevelLatin: null,
  competitionLevelStandard: null,
  ...overrides,
});

const nationale = { competitionType: "NATIONALE" };

describe("evaluateEventEligibility", () => {
  it("requires an age class", () => {
    expect(
      evaluateEventEligibility(event(), nationale, profile({ ageGroup: null })),
    ).toEqual({ eligible: false, reason: "AGE_GROUP_REQUIRED" });
    expect(
      evaluateEventEligibility(event(), nationale, profile({ ageGroup: "  " })),
    ).toEqual({ eligible: false, reason: "AGE_GROUP_REQUIRED" });
    expect(evaluateEventEligibility(event(), nationale, null)).toEqual({
      eligible: false,
      reason: "AGE_GROUP_REQUIRED",
    });
  });

  it("rejects a discipline the dancer does not practise", () => {
    expect(
      evaluateEventEligibility(
        event({ category: "Standard" }),
        nationale,
        profile({ category: "Latin" }),
      ),
    ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });
  });

  it("does not block on the discipline when the profile has none", () => {
    expect(
      evaluateEventEligibility(
        event({ category: "Standard" }),
        nationale,
        profile({ category: null }),
      ).eligible,
    ).toBe(true);
  });

  it("accepts a Ten Dance dancer in a Latin épreuve (no strict equality)", () => {
    expect(
      evaluateEventEligibility(
        event({ category: "Latin" }),
        nationale,
        profile({ category: "Ten Dance" }),
      ).eligible,
    ).toBe(true);
  });

  it("accepts a discipline covered by a per-discipline level", () => {
    expect(
      evaluateEventEligibility(
        event({ category: "Standard" }),
        nationale,
        profile({ category: "Latin", competitionLevelStandard: "Débutant" }),
      ).eligible,
    ).toBe(true);
  });

  it("applies the Article 9 upward choices (Youth → Adulte)", () => {
    expect(
      evaluateEventEligibility(
        event({ ageGroup: "Adulte" }),
        nationale,
        profile({ ageGroup: "Youth" }),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateEventEligibility(
        event({ ageGroup: "Junior I" }),
        nationale,
        profile({ ageGroup: "Adulte" }),
      ).eligible,
    ).toBe(false);
  });

  describe("level is read in the event discipline", () => {
    const classif = (category: string, level: string) =>
      event({ category, level, eventKind: "CLASSIFICATRICE" });
    const dancer = profile({
      category: "Ten Dance",
      competitionLevelLatin: "International",
      competitionLevelStandard: "Intermédiaire",
    });

    it("International in Latin can enter a Latin Avancé classificatrice", () => {
      expect(
        evaluateEventEligibility(classif("Latin", "Avancé"), nationale, dancer)
          .eligible,
      ).toBe(true);
    });

    it("Intermédiaire in Standard cannot enter a Standard Avancé classificatrice", () => {
      const result = evaluateEventEligibility(
        classif("Standard", "Avancé"),
        nationale,
        dancer,
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Intermédiaire");
    });

    it("falls back to the legacy single level", () => {
      expect(
        evaluateEventEligibility(
          classif("Latin", "Avancé"),
          nationale,
          profile({ competitionLevel: "Avancé" }),
        ).eligible,
      ).toBe(true);
    });

    it("a classificatrice needs a level in that discipline", () => {
      const result = evaluateEventEligibility(
        classif("Latin", "Débutant"),
        nationale,
        profile(),
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("non renseigné");
    });
  });

  describe("Ten Dance", () => {
    const tenDance = event({
      category: "Ten Dance",
      eventKind: "MAJEURE",
      level: "International",
    });

    it("is open to a dancer with both disciplines (both levels)", () => {
      expect(
        evaluateEventEligibility(
          tenDance,
          nationale,
          profile({
            category: "Latin",
            competitionLevelLatin: "Débutant",
            competitionLevelStandard: "Débutant",
          }),
        ),
      ).toEqual({ eligible: true });
    });

    it("is open to a dancer declared Ten Dance", () => {
      expect(
        evaluateEventEligibility(
          tenDance,
          nationale,
          profile({ category: "Ten Dance" }),
        ).eligible,
      ).toBe(true);
    });

    it("is closed to a dancer with only one discipline", () => {
      expect(
        evaluateEventEligibility(
          tenDance,
          nationale,
          profile({
            category: "Latin",
            competitionLevelLatin: "International",
          }),
        ),
      ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });
    });

    it("ignores the level, even on a levelled classificatrice row", () => {
      expect(
        evaluateEventEligibility(
          event({
            category: "Ten Dance",
            eventKind: "CLASSIFICATRICE",
            level: "International",
          }),
          nationale,
          profile({ category: "Ten Dance", competitionLevelLatin: "Débutant" }),
        ).eligible,
      ).toBe(true);
    });
  });
});

describe("enrichCompetitionsForUser", () => {
  const makeComp = (
    events: EligibilityEventInput[],
    registrations: unknown[] = [],
  ) => ({
    id: "1",
    competitionType: "NATIONALE",
    events: events.map((e) => ({ ...e, registrations })),
  });

  it("marks every competition eligible for an anonymous visitor", () => {
    const result = enrichCompetitionsForUser(
      [makeComp([event()]), makeComp([event({ category: "Standard" })])],
      null,
    );
    expect(result.every((c) => c.isEligible)).toBe(true);
  });

  it("is eligible when at least one event is", () => {
    const result = enrichCompetitionsForUser(
      [makeComp([event({ category: "Standard" }), event()])],
      profile(),
    );
    expect(result[0].isEligible).toBe(true);
  });

  it("is not eligible when the discipline does not match", () => {
    const result = enrichCompetitionsForUser(
      [makeComp([event()])],
      profile({ category: "Standard" }),
    );
    expect(result[0].isEligible).toBe(false);
  });

  it("follows the Article 9 upward choice instead of strict age equality", () => {
    const result = enrichCompetitionsForUser(
      [makeComp([event({ ageGroup: "Adulte" })])],
      profile({ ageGroup: "Youth" }),
    );
    expect(result[0].isEligible).toBe(true);
  });

  it("matches the detail screen for every event (same rule)", () => {
    const events = [
      event({ category: "Standard" }),
      event({ ageGroup: "Junior I" }),
      event({ eventKind: "CLASSIFICATRICE", level: "Avancé" }),
      event({ category: "Ten Dance", eventKind: "MAJEURE" }),
    ];
    const user = profile({ competitionLevelLatin: "Intermédiaire" });
    for (const e of events) {
      const [listed] = enrichCompetitionsForUser([makeComp([e])], user);
      const [detailed] = mapEventsWithEligibility([e], nationale, user);
      expect(listed.isEligible).toBe(detailed.eligibility.eligible);
    }
  });

  it("flags registrations", () => {
    expect(
      enrichCompetitionsForUser([makeComp([event()], [{ id: "r" }])], null)[0]
        .isRegistered,
    ).toBe(true);
    expect(
      enrichCompetitionsForUser([makeComp([event()], [])], null)[0]
        .isRegistered,
    ).toBe(false);
  });
});

describe("mapEventsWithEligibility", () => {
  it("adds the eligibility of each event", () => {
    const result = mapEventsWithEligibility(
      [event(), event({ category: "Standard" })],
      nationale,
      profile(),
    );
    expect(result.map((e) => e.eligibility)).toEqual([
      { eligible: true },
      { eligible: false, reason: "WRONG_CATEGORY" },
    ]);
    expect(result[0].category).toBe("Latin");
  });

  it("reports AGE_GROUP_REQUIRED without a profile", () => {
    const [result] = mapEventsWithEligibility([event()], nationale, null);
    expect(result.eligibility).toEqual({
      eligible: false,
      reason: "AGE_GROUP_REQUIRED",
    });
  });
});
