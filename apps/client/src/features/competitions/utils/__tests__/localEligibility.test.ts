import { evaluateLocalEligibility } from "../localEligibility";

describe("evaluateLocalEligibility", () => {
  const adult = { ageGroup: "Adulte" };

  it("accepts a dancer whose declared category is the event discipline", () => {
    expect(
      evaluateLocalEligibility(
        { category: "Latin", ageGroup: "Adulte" },
        { ...adult, category: "Latin" },
      ),
    ).toEqual({ eligible: true });
  });

  it("accepts a dancer with a level in the event discipline", () => {
    expect(
      evaluateLocalEligibility(
        { category: "Standard" },
        { ...adult, category: "Latin", competitionLevelStandard: "Débutant" },
      ),
    ).toEqual({ eligible: true });
  });

  it("refuses a discipline the dancer does not practise", () => {
    expect(
      evaluateLocalEligibility(
        { category: "Standard" },
        { ...adult, category: "Latin", competitionLevelLatin: "Avancé" },
      ),
    ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });
  });

  it("requires both disciplines for a Ten Dance event, whatever the level", () => {
    expect(
      evaluateLocalEligibility(
        { category: "Ten Dance" },
        { ...adult, category: "Latin", competitionLevelLatin: "International" },
      ),
    ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });
    expect(
      evaluateLocalEligibility(
        { category: "10 danses" },
        {
          ...adult,
          competitionLevelLatin: "Débutant",
          competitionLevelStandard: "Débutant",
        },
      ),
    ).toEqual({ eligible: true });
    expect(
      evaluateLocalEligibility(
        { category: "Ten Dance" },
        { ...adult, category: "Ten Dance" },
      ),
    ).toEqual({ eligible: true });
  });

  it("does not block a profile without any discipline information", () => {
    expect(evaluateLocalEligibility({ category: "Latin" }, adult)).toEqual({
      eligible: true,
    });
  });

  it("compares an unknown event discipline to the declared category", () => {
    expect(
      evaluateLocalEligibility({ category: "A" }, { ...adult, category: "B" }),
    ).toEqual({ eligible: false, reason: "WRONG_CATEGORY" });
    expect(
      evaluateLocalEligibility({ category: "A" }, { ...adult, category: "a" }),
    ).toEqual({ eligible: true });
  });

  it("checks the age class after the discipline", () => {
    expect(
      evaluateLocalEligibility(
        { category: "Latin", ageGroup: "Junior" },
        { ...adult, category: "Latin" },
      ),
    ).toEqual({ eligible: false, reason: "WRONG_AGE_GROUP" });
  });

  it("accepts an event without category nor age class", () => {
    expect(evaluateLocalEligibility({}, {})).toEqual({ eligible: true });
  });
});
