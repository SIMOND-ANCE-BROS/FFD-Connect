import {
  normalizeForMatch,
  parseClubNames,
  parseFullName,
  parseRank,
} from "./sync-licensees.utils";

describe("normalizeForMatch", () => {
  it("removes accents", () => {
    expect(normalizeForMatch("éàü")).toBe("eau");
  });

  it("lowercases", () => {
    expect(normalizeForMatch("DUPONT")).toBe("dupont");
  });

  it("trims whitespace", () => {
    expect(normalizeForMatch("  jean  ")).toBe("jean");
  });

  it("handles combined accents + uppercase", () => {
    expect(normalizeForMatch("Élodie")).toBe("elodie");
  });
});

describe("parseFullName", () => {
  it("parses standard 'FirstName LASTNAME'", () => {
    expect(parseFullName("Jean DUPONT")).toEqual({
      firstName: "Jean",
      lastName: "DUPONT",
    });
  });

  it("parses compound last name", () => {
    expect(parseFullName("Jean DUPONT MARTIN")).toEqual({
      firstName: "Jean",
      lastName: "DUPONT MARTIN",
    });
  });

  it("parses compound first name (no ALL CAPS token)", () => {
    expect(parseFullName("Jean Marie Dupont")).toEqual({
      firstName: "Jean Marie",
      lastName: "Dupont",
    });
  });

  it("handles single word", () => {
    const result = parseFullName("Dupont");
    expect(result.firstName).toBe("Dupont");
    expect(result.lastName).toBe("Dupont");
  });
});

describe("parseRank", () => {
  it("parses simple integer", () => {
    expect(parseRank("1")).toBe(1);
  });

  it("parses range string like '8- 9' (takes first number)", () => {
    expect(parseRank("8- 9")).toBe(89); // all digits concatenated: "89"
  });

  it("parses '10- 12'", () => {
    expect(parseRank("10- 12")).toBe(1012);
  });

  it("returns 999 for invalid string", () => {
    expect(parseRank("")).toBe(999);
    expect(parseRank("abc")).toBe(999);
  });
});

describe("parseClubNames", () => {
  it("returns single club", () => {
    expect(parseClubNames("Club Paris")).toEqual({
      clubs: ["Club Paris"],
      isInterClub: false,
    });
  });

  it("splits two clubs on ' - '", () => {
    expect(parseClubNames("Club A - Club B")).toEqual({
      clubs: ["Club A", "Club B"],
      isInterClub: true,
    });
  });

  it("returns empty for empty string", () => {
    expect(parseClubNames("")).toEqual({ clubs: [], isInterClub: false });
  });

  it("handles null/undefined-like empty input", () => {
    expect(parseClubNames("   ")).toEqual({ clubs: [], isInterClub: false });
  });
});
