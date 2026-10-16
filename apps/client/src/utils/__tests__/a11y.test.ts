import { formatSpokenDuration, joinA11yLabel, toSpokenCase } from "../a11y";

describe("joinA11yLabel", () => {
  it("joins the non-empty parts with a comma pause", () => {
    expect(joinA11yLabel(["Open de Lyon", "À venir", 12, "Lyon"])).toBe(
      "Open de Lyon, À venir, 12, Lyon",
    );
  });

  it("drops null, undefined, false and blank parts", () => {
    expect(
      joinA11yLabel(["Titre", null, undefined, false, "", "   ", " Artiste "]),
    ).toBe("Titre, Artiste");
  });

  it("keeps a zero (a real value, not an empty part)", () => {
    expect(joinA11yLabel(["Dossard", 0])).toBe("Dossard, 0");
  });

  it("returns an empty string when nothing is left", () => {
    expect(joinA11yLabel([null, false])).toBe("");
  });
});

describe("toSpokenCase", () => {
  it("turns an all-caps badge into sentence case", () => {
    expect(toSpokenCase("EN DIRECT")).toBe("En direct");
    expect(toSpokenCase("À VENIR")).toBe("À venir");
    expect(toSpokenCase(" TERMINÉ ")).toBe("Terminé");
  });

  it("handles an empty string", () => {
    expect(toSpokenCase("")).toBe("");
  });
});

describe("formatSpokenDuration", () => {
  it.each([
    [0, "0 seconde"],
    [1, "1 seconde"],
    [45.9, "45 secondes"],
    [60, "1 minute"],
    [120, "2 minutes"],
    [61, "1 minute 1 seconde"],
    [125, "2 minutes 5 secondes"],
  ])("%p s → %p", (seconds, expected) => {
    expect(formatSpokenDuration(seconds)).toBe(expected);
  });

  it("treats negative and non-finite values as zero", () => {
    expect(formatSpokenDuration(-5)).toBe("0 seconde");
    expect(formatSpokenDuration(Number.NaN)).toBe("0 seconde");
    expect(formatSpokenDuration(Number.POSITIVE_INFINITY)).toBe("0 seconde");
  });
});
