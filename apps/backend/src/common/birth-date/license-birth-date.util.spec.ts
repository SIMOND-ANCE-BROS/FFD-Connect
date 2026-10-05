import {
  MAX_PLAUSIBLE_LICENSEE_AGE_YEARS,
  extractBirthDateFromLicenseNumber,
} from "./license-birth-date.util";

/** Fixed "now" so the plausibility window never drifts with the wall clock. */
const NOW = new Date("2026-10-05T12:00:00.000Z");

describe("extractBirthDateFromLicenseNumber", () => {
  describe("conforming numbers", () => {
    it("returns the encoded birth date, at UTC midnight", () => {
      const result = extractBirthDateFromLicenseNumber(
        "20051203-dup-ga42",
        NOW,
      );

      expect(result?.toISOString()).toBe("2005-12-03T00:00:00.000Z");
    });

    it("pins the date to UTC so the calendar day cannot drift by timezone", () => {
      const result = extractBirthDateFromLicenseNumber(
        "20060101-dup-ga42",
        NOW,
      );

      expect(result?.getUTCFullYear()).toBe(2006);
      expect(result?.getUTCMonth()).toBe(0);
      expect(result?.getUTCDate()).toBe(1);
    });

    it("accepts an upper-cased number and surrounding whitespace", () => {
      const result = extractBirthDateFromLicenseNumber(
        "  20051203-DUP-GA42  ",
        NOW,
      );

      expect(result?.toISOString()).toBe("2005-12-03T00:00:00.000Z");
    });

    it("accepts a real leap day", () => {
      const result = extractBirthDateFromLicenseNumber(
        "20040229-dup-ga42",
        NOW,
      );

      expect(result?.toISOString()).toBe("2004-02-29T00:00:00.000Z");
    });

    it("accepts a birth date of today (age 0 is implausible but not impossible)", () => {
      const result = extractBirthDateFromLicenseNumber(
        "20261005-dup-ga42",
        NOW,
      );

      expect(result?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    });
  });

  describe("refuses rather than guessing", () => {
    // The seed/e2e fixtures use this shape. It must yield "unknown", never a
    // date and never a throw — the whole point of #60 is that an unparsable
    // number leaves birthDate null instead of inventing one.
    it("returns null for the test fixture number TEST-LICENSEE-001", () => {
      expect(() =>
        extractBirthDateFromLicenseNumber("TEST-LICENSEE-001", NOW),
      ).not.toThrow();
      expect(extractBirthDateFromLicenseNumber("TEST-LICENSEE-001", NOW)).toBe(
        null,
      );
    });

    it.each([
      ["a legacy/other-grammar number", "FFD-2025-12345"],
      ["a number with no separators", "20051203dupga42"],
      ["a bare date", "20051203"],
      ["a date-prefixed but otherwise free-form number", "20051203-dupont-ga"],
      ["too few letters in the surname segment", "20051203-du-ga42"],
      ["too many letters in the surname segment", "20051203-dupo-ga42"],
      ["letters where the 2-digit suffix belongs", "20051203-dup-gaxy"],
      ["a 3-digit suffix", "20051203-dup-ga421"],
      ["a seven-digit date", "2005123-dup-ga42"],
      ["a nine-digit date", "200512031-dup-ga42"],
      ["accented letters", "20051203-dúp-ga42"],
      ["trailing junk", "20051203-dup-ga42-bis"],
      ["leading junk", "x20051203-dup-ga42"],
      ["an empty string", ""],
      ["whitespace only", "   "],
    ])("returns null for %s", (_label, input) => {
      expect(extractBirthDateFromLicenseNumber(input, NOW)).toBe(null);
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
    ])("returns null for %s", (_label, input) => {
      expect(extractBirthDateFromLicenseNumber(input, NOW)).toBe(null);
    });

    it.each([
      ["31 February", "20250231-dup-ga42"],
      ["29 February on a non-leap year", "20030229-dup-ga42"],
      ["31 April", "20050431-dup-ga42"],
      ["month 00", "20050003-dup-ga42"],
      ["month 13", "20051303-dup-ga42"],
      ["day 00", "20051200-dup-ga42"],
      ["day 32", "20051232-dup-ga42"],
    ])("returns null for the impossible date %s", (_label, input) => {
      expect(extractBirthDateFromLicenseNumber(input, NOW)).toBe(null);
    });

    it("returns null for a date in the future", () => {
      expect(extractBirthDateFromLicenseNumber("20261006-dup-ga42", NOW)).toBe(
        null,
      );
    });

    it("returns null for a two-digit year that would silently become 19xx", () => {
      // Date.UTC(85, …) resolves to 1985. Round-tripping the components is what
      // stops that from passing as a valid 0085 birth date.
      expect(extractBirthDateFromLicenseNumber("00851203-dup-ga42", NOW)).toBe(
        null,
      );
    });

    it("returns null for an implausibly old licensee", () => {
      const tooOldYear =
        NOW.getUTCFullYear() - MAX_PLAUSIBLE_LICENSEE_AGE_YEARS - 1;

      expect(
        extractBirthDateFromLicenseNumber(`${tooOldYear}0101-dup-ga42`, NOW),
      ).toBe(null);
    });

    it("accepts the oldest still-plausible licensee", () => {
      const oldestYear =
        NOW.getUTCFullYear() - MAX_PLAUSIBLE_LICENSEE_AGE_YEARS;

      expect(
        extractBirthDateFromLicenseNumber(`${oldestYear}0101-dup-ga42`, NOW),
      ).not.toBe(null);
    });
  });

  it("defaults to the current time when no reference date is given", () => {
    expect(extractBirthDateFromLicenseNumber("20051203-dup-ga42")).not.toBe(
      null,
    );
  });
});
