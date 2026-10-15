import { holderInitials } from "../holderInitials";

describe("holderInitials", () => {
  it("takes the first letter of the first and last names", () => {
    expect(holderInitials("John", "Doe")).toBe("JD");
  });

  it("keeps a single initial per name for compound names", () => {
    expect(holderInitials("Jean-Pierre", "De La Tour")).toBe("JD");
  });

  it("upper-cases accented letters", () => {
    expect(holderInitials("élodie", "éclair")).toBe("ÉÉ");
  });

  it("uses the first two words of a club name (no first name)", () => {
    expect(holderInitials("", "Danse Club Lyon")).toBe("DC");
  });

  it("uses a single letter for a one-word name", () => {
    expect(holderInitials("", "Dancefloor")).toBe("D");
  });

  it("skips leading punctuation", () => {
    expect(holderInitials("'Anna", "(Smith)")).toBe("AS");
  });

  it("returns an empty string when no letter is available", () => {
    expect(holderInitials("  ", "")).toBe("");
    expect(holderInitials("", "--")).toBe("");
  });
});
