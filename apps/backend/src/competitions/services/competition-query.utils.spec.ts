import {
  enrichCompetitionsForUser,
  mapEventsWithEligibility,
} from "./competition-query.utils";

const baseEvent = {
  eventType: "STANDARD",
  ageGroup: "ADULT",
  category: "LATIN",
  level: null,
  eventKind: null,
};

const baseCompetition = { competitionType: "CLUB" };

describe("enrichCompetitionsForUser", () => {
  const makeComp = (
    category: string,
    ageGroup: string,
    registrations: unknown[] = [],
  ) => ({
    id: "1",
    events: [{ category, ageGroup, registrations }],
  });

  it("should mark all competitions as isEligible when user is null", () => {
    const comps = [makeComp("LATIN", "ADULT"), makeComp("STANDARD", "JUNIOR")];
    const result = enrichCompetitionsForUser(comps, null);
    expect(result.every((c) => c.isEligible)).toBe(true);
  });

  it("should mark competition as isEligible when user category and ageGroup match", () => {
    const comps = [makeComp("LATIN", "ADULT")];
    const result = enrichCompetitionsForUser(comps, {
      category: "LATIN",
      ageGroup: "ADULT",
    });
    expect(result[0].isEligible).toBe(true);
  });

  it("should mark competition as not isEligible when user category does not match", () => {
    const comps = [makeComp("LATIN", "ADULT")];
    const result = enrichCompetitionsForUser(comps, {
      category: "STANDARD",
      ageGroup: "ADULT",
    });
    expect(result[0].isEligible).toBe(false);
  });

  it("should mark competition as isRegistered when at least one event has registrations", () => {
    const comps = [makeComp("LATIN", "ADULT", [{ id: "reg1" }])];
    const result = enrichCompetitionsForUser(comps, null);
    expect(result[0].isRegistered).toBe(true);
  });

  it("should mark competition as not isRegistered when no events have registrations", () => {
    const comps = [makeComp("LATIN", "ADULT", [])];
    const result = enrichCompetitionsForUser(comps, null);
    expect(result[0].isRegistered).toBe(false);
  });
});

describe("mapEventsWithEligibility", () => {
  it("should return eligible=false with reason AGE_GROUP_REQUIRED when registrantAgeGroup is null", () => {
    const result = mapEventsWithEligibility(
      [baseEvent],
      baseCompetition,
      null,
      "LATIN",
    );
    expect(result[0].eligibility.eligible).toBe(false);
    expect(result[0].eligibility.reason).toBe("AGE_GROUP_REQUIRED");
  });

  it("should return eligible=false with reason WRONG_CATEGORY when categories do not match", () => {
    const result = mapEventsWithEligibility(
      [baseEvent],
      baseCompetition,
      "ADULT",
      "STANDARD",
    );
    expect(result[0].eligibility.eligible).toBe(false);
    expect(result[0].eligibility.reason).toBe("WRONG_CATEGORY");
  });

  it("should return eligible=true when event matches registrant ageGroup and category", () => {
    const result = mapEventsWithEligibility(
      [baseEvent],
      baseCompetition,
      "ADULT",
      "LATIN",
    );
    expect(result[0].eligibility.eligible).toBe(true);
    expect(result[0].eligibility.reason).toBeUndefined();
  });
});
