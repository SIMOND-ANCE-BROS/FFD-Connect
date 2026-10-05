import { computePartnershipSuggestion } from "./partnership-suggestion.util";

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  birthDate: new Date("1995-06-15"),
  passportLevelLatin: null as string | null,
  passportLevelStandard: null as string | null,
  category: null as string | null,
  competitionLevel: null as string | null,
  ...overrides,
});

describe("computePartnershipSuggestion", () => {
  const startDate = new Date("2024-01-01");

  it("returns null suggestedLevel and default categories when no passport levels", () => {
    const u1 = makeUser();
    const u2 = makeUser();
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedLevel).toBeNull();
    expect(result.suggestedCategories).toEqual(
      expect.arrayContaining(["Latine", "Standard"]),
    );
  });

  it("infers Latine category from category field", () => {
    const u1 = makeUser({ category: "Latine" });
    const u2 = makeUser({ category: "Latine" });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain("Latine");
    expect(result.suggestedCategories).not.toContain("Standard");
  });

  it("infers Standard category from category field", () => {
    const u1 = makeUser({ category: "Standard" });
    const u2 = makeUser({ category: "Standard" });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain("Standard");
    expect(result.suggestedCategories).not.toContain("Latine");
  });

  it("returns both categories when one user has Latin and the other Standard", () => {
    const u1 = makeUser({ category: "Latine" });
    const u2 = makeUser({ category: "Standard" });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain("Latine");
    expect(result.suggestedCategories).toContain("Standard");
  });

  it("infers 10 danses from category containing '10'", () => {
    const u1 = makeUser({ category: "10 danses" });
    const u2 = makeUser({ category: "10 danses" });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.suggestedCategories).toContain("10 danses");
  });

  it("returns coupleAgeGroup when both users have birthDates", () => {
    const u1 = makeUser({ birthDate: new Date("1995-01-01") });
    const u2 = makeUser({ birthDate: new Date("1993-01-01") });
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.coupleAgeGroup).not.toBeNull();
  });

  it("returns null coupleAgeGroup when a user has no birthDate", () => {
    const u1 = makeUser({ birthDate: null });
    const u2 = makeUser();
    const result = computePartnershipSuggestion(u1, u2, startDate);
    expect(result.coupleAgeGroup).toBeNull();
  });
});
