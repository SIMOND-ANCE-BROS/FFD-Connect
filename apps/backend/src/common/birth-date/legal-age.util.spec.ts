import {
  LEGAL_MAJORITY_AGE_YEARS,
  assessLegalAge,
  completedYearsBetween,
  matchLegalAge,
  type LegalAgeAssessment,
} from "./legal-age.util";

const NOW = new Date("2026-10-05T12:00:00.000Z");

/** Birth date, at UTC midnight, for someone turning `years` old on `NOW`'s day. */
const bornYearsBeforeNow = (years: number, dayOffset = 0): Date =>
  new Date(
    Date.UTC(
      NOW.getUTCFullYear() - years,
      NOW.getUTCMonth(),
      NOW.getUTCDate() + dayOffset,
    ),
  );

describe("assessLegalAge", () => {
  describe('"we do not know" is its own answer', () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
    ])("reports UNKNOWN for %s — never ADULT", (_label, birthDate) => {
      expect(assessLegalAge(birthDate, NOW)).toEqual({ status: "UNKNOWN" });
    });

    it("reports UNKNOWN for an invalid Date", () => {
      expect(assessLegalAge(new Date("not-a-date"), NOW)).toEqual({
        status: "UNKNOWN",
      });
    });

    it("reports UNKNOWN for a birth date in the future", () => {
      expect(assessLegalAge(bornYearsBeforeNow(-1), NOW)).toEqual({
        status: "UNKNOWN",
      });
    });

    it("exposes no age on UNKNOWN, so no caller can read one by accident", () => {
      const assessment = assessLegalAge(null, NOW);

      expect(Object.keys(assessment)).toEqual(["status"]);
    });
  });

  describe("minor", () => {
    it("reports MINOR with the completed age for a 17-year-old", () => {
      expect(assessLegalAge(bornYearsBeforeNow(17), NOW)).toEqual({
        status: "MINOR",
        age: 17,
      });
    });

    it("still reports MINOR the day before the 18th birthday", () => {
      expect(
        assessLegalAge(bornYearsBeforeNow(LEGAL_MAJORITY_AGE_YEARS, 1), NOW),
      ).toEqual({ status: "MINOR", age: 17 });
    });

    it("reports MINOR for a newborn", () => {
      expect(assessLegalAge(bornYearsBeforeNow(0), NOW)).toEqual({
        status: "MINOR",
        age: 0,
      });
    });
  });

  describe("adult", () => {
    it("reports ADULT on the 18th birthday itself", () => {
      expect(
        assessLegalAge(bornYearsBeforeNow(LEGAL_MAJORITY_AGE_YEARS), NOW),
      ).toEqual({ status: "ADULT", age: LEGAL_MAJORITY_AGE_YEARS });
    });

    it("reports ADULT for a 40-year-old", () => {
      expect(assessLegalAge(bornYearsBeforeNow(40), NOW)).toEqual({
        status: "ADULT",
        age: 40,
      });
    });
  });

  it("defaults to the current time when no reference date is given", () => {
    expect(assessLegalAge(new Date("1990-01-01T00:00:00.000Z")).status).toBe(
      "ADULT",
    );
  });
});

describe("completedYearsBetween", () => {
  it("counts whole years only", () => {
    expect(
      completedYearsBetween(new Date("2000-10-06T00:00:00.000Z"), NOW),
    ).toBe(25);
    expect(
      completedYearsBetween(new Date("2000-10-05T00:00:00.000Z"), NOW),
    ).toBe(26);
    expect(
      completedYearsBetween(new Date("2000-09-05T00:00:00.000Z"), NOW),
    ).toBe(26);
  });

  it("returns a negative count for a date in the future", () => {
    expect(
      completedYearsBetween(new Date("2030-01-01T00:00:00.000Z"), NOW),
    ).toBeLessThan(0);
  });
});

describe("matchLegalAge", () => {
  const cases: [string, LegalAgeAssessment, string][] = [
    ["MINOR", { status: "MINOR", age: 12 }, "minor:12"],
    ["ADULT", { status: "ADULT", age: 30 }, "adult:30"],
    ["UNKNOWN", { status: "UNKNOWN" }, "unknown"],
  ];

  it.each(cases)(
    "routes %s to its own branch",
    (_label, assessment, expected) => {
      const result = matchLegalAge(assessment, {
        onMinor: (age) => `minor:${age}`,
        onAdult: (age) => `adult:${age}`,
        onUnknown: () => "unknown",
      });

      expect(result).toBe(expected);
    },
  );
});
