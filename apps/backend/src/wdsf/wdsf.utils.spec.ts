import { HttpException } from "@nestjs/common";
import {
  extractPhotoUrl,
  getStructureDisplayName,
  normalizeBirthDate,
  parseNamePart,
  nameTokens,
  wdsfNameMatches,
  parsePersonsToAthlete,
  resolveWdsfFederation,
} from "./wdsf.utils";

describe("wdsf.utils", () => {
  describe("normalizeBirthDate", () => {
    it("returns empty string for null", () => {
      expect(normalizeBirthDate(null)).toBe("");
    });
    it("returns empty string for empty string", () => {
      expect(normalizeBirthDate("")).toBe("");
    });
    it("returns trimmed string as-is", () => {
      expect(normalizeBirthDate("1990-01-01")).toBe("1990-01-01");
    });
    it("formats { year, month, day } object", () => {
      expect(normalizeBirthDate({ year: 1990, month: 3, day: 5 })).toBe(
        "1990-03-05",
      );
    });
    it("returns empty string for year=0", () => {
      expect(normalizeBirthDate({ year: 0, month: 1, day: 1 })).toBe("");
    });
  });

  describe("getStructureDisplayName", () => {
    it("returns empty string for empty code", () => {
      expect(getStructureDisplayName("")).toBe("");
    });
    it("maps FFD (uppercase) to full display name", () => {
      expect(getStructureDisplayName("FFD")).toBe(
        "FFD - Fédération Française de Danse",
      );
    });
    it("maps ffd (lowercase) via toUpperCase", () => {
      expect(getStructureDisplayName("ffd")).toBe(
        "FFD - Fédération Française de Danse",
      );
    });
    it("returns code as-is for unknown codes", () => {
      expect(getStructureDisplayName("UNKNOWN_FED")).toBe("UNKNOWN_FED");
    });
  });

  describe("extractPhotoUrl", () => {
    it("returns undefined when no photo keys present", () => {
      expect(extractPhotoUrl({ firstName: "John" })).toBeUndefined();
    });
    it("returns photoUrl when present and starts with http", () => {
      expect(
        extractPhotoUrl({ photoUrl: "https://example.com/photo.jpg" }),
      ).toBe("https://example.com/photo.jpg");
    });
    it("returns undefined when value does not start with http", () => {
      expect(
        extractPhotoUrl({ photoUrl: "/relative/path.jpg" }),
      ).toBeUndefined();
    });
  });

  describe("parseNamePart", () => {
    it("returns empty string for non-string input", () => {
      expect(parseNamePart(null, "first")).toBe("");
    });
    it("returns first word for part=first", () => {
      expect(parseNamePart("John Doe", "first")).toBe("John");
    });
    it("returns remaining words for part=last", () => {
      expect(parseNamePart("John Michael Doe", "last")).toBe("Michael Doe");
    });
    it("returns empty string for last when single word", () => {
      expect(parseNamePart("John", "last")).toBe("");
    });
  });

  describe("parsePersonsToAthlete", () => {
    it("throws 404 HttpException when data is empty array", () => {
      let caught: unknown;
      try {
        parsePersonsToAthlete([], "12345");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(404);
      expect((caught as HttpException).getResponse()).toMatchObject({
        code: "WDSF_ATHLETE_NOT_FOUND",
      });
    });

    it("maps a basic athlete object", () => {
      const data = [
        {
          min: "12345",
          firstName: "John",
          lastName: "Doe",
          birthDate: "1990-01-01",
          country: { name: "France" },
          status: "Active",
          memberBody: { name: "FFD" },
          ageGroup: "Adult",
          gender: "Male",
        },
      ];
      const result = parsePersonsToAthlete(data, "12345");
      expect(result).toMatchObject({
        firstName: "John",
        lastName: "Doe",
        licenseNumber: "12345",
        birthDate: "1990-01-01",
        country: "France",
        status: "Active",
        structure: "FFD - Fédération Française de Danse",
        type: "Athlete's License",
        validUntil: "Active",
        ageGroup: "Adult",
        gender: "Male",
      });
    });

    it("handles single-person wrapped object (v1 response)", () => {
      const data = {
        id: "99999",
        firstName: "Jane",
        lastName: "Smith",
        country: "Germany",
        ageGroup: "Adult",
        gender: "Female",
      };
      const result = parsePersonsToAthlete(data, "99999");
      expect(result.firstName).toBe("Jane");
      expect(result.licenseNumber).toBe("99999");
    });

    it("applies France fallback structure when memberBody missing and country is France", () => {
      const data = [
        {
          min: "11111",
          firstName: "Pierre",
          lastName: "Martin",
          country: { name: "France" },
          ageGroup: "Adult",
          gender: "Male",
        },
      ];
      const result = parsePersonsToAthlete(data, "11111");
      expect(result.structure).toBe("FFD - Fédération Française de Danse");
    });

    it("never reports WDSF as the national federation", () => {
      const result = parsePersonsToAthlete(
        [
          {
            min: "22222",
            firstName: "Jane",
            lastName: "Smith",
            country: { name: "Germany" },
            memberBody: { name: "WDSF" },
          },
        ],
        "22222",
      );
      expect(result.structure).toBe("");
    });

    it("prefers the FFD over a WDSF member body for a French athlete", () => {
      const result = parsePersonsToAthlete(
        [
          {
            min: "33333",
            firstName: "Paul",
            lastName: "Durand",
            country: "FRA",
            memberBody: { name: "WDSF" },
          },
        ],
        "33333",
      );
      expect(result.structure).toBe("FFD - Fédération Française de Danse");
    });
  });

  describe("resolveWdsfFederation", () => {
    it.each([
      ["FFD", null, "FFD - Fédération Française de Danse"],
      ["DTV", "Germany", "DTV"],
      ["WDSF", "France", "FFD - Fédération Française de Danse"],
      [null, "fra", "FFD - Fédération Française de Danse"],
      ["WDSF", "Germany", ""],
      [undefined, undefined, ""],
    ])("member body %s, country %s → %s", (memberBody, country, expected) => {
      expect(resolveWdsfFederation(memberBody, country)).toBe(expected);
    });
  });

  describe("wdsfNameMatches", () => {
    it.each([
      ["Gabin Simond", "Gabin", "Simond"],
      ["Simond Gabin", "Gabin", "Simond"],
      ["SIMOND Gabin", "gabin", "simond"],
      ["Jean Pierre Dupré", "Jean-Pierre", "Dupre"],
      ["Anne Marie D'Arc", "Anne", "d’Arc"],
      ["Gabin Louis Simond", "Gabin", "Simond"],
    ])("matches %s with %s %s", (wdsf, first, last) => {
      expect(wdsfNameMatches(wdsf, first, last)).toBe(true);
    });

    it.each([
      ["Gabin Simond", "Noelie", "Bazin"],
      ["Gabin Simond", "Gabin", "Simon"],
      ["Gabin", "Gabin", "Simond"],
      ["", "Gabin", "Simond"],
      ["Gabin Simond", "", "Simond"],
      ["Gabin Simond", "Gabin", ""],
    ])("rejects %s with %s %s", (wdsf, first, last) => {
      expect(wdsfNameMatches(wdsf, first, last)).toBe(false);
    });

    it("tokenizes without accents, case or punctuation", () => {
      expect(nameTokens("  Éloïse-Marie  O'Brien ")).toEqual([
        "eloise",
        "marie",
        "o",
        "brien",
      ]);
    });
  });

  describe("parsePersonsToAthlete with a full-name-only record", () => {
    it("splits name into first and last name without duplicating it", () => {
      const athlete = parsePersonsToAthlete(
        [{ id: "10117265", name: "Gabin Simond", country: "France" }],
        "10117265",
      );

      expect(athlete.firstName).toBe("Gabin");
      expect(athlete.lastName).toBe("Simond");
    });
  });
});
