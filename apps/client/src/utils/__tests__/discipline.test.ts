import { formatDiscipline } from "../discipline";

describe("formatDiscipline", () => {
  it.each([
    ["Latin", "Latines"],
    ["latin", "Latines"],
    ["LATIN", "Latines"],
    ["Latine", "Latines"],
    ["Latines", "Latines"],
    ["  latines ", "Latines"],
    ["Standard", "Standards"],
    ["standard", "Standards"],
    ["STANDARDS", "Standards"],
    ["Ten Dance", "10 danses"],
    ["ten dance", "10 danses"],
    ["TEN_DANCE", "10 danses"],
    ["Ten-Dance", "10 danses"],
    ["10 danses", "10 danses"],
    ["10 Dances", "10 danses"],
    ["Dix danses", "10 danses"],
  ])("maps %p to %p", (input, expected) => {
    expect(formatDiscipline(input)).toBe(expected);
  });

  it("returns unknown values unchanged", () => {
    expect(formatDiscipline("Adulte")).toBe("Adulte");
    expect(formatDiscipline("Rock")).toBe("Rock");
    expect(formatDiscipline("")).toBe("");
  });

  it("returns an empty string for null or undefined", () => {
    expect(formatDiscipline(null)).toBe("");
    expect(formatDiscipline(undefined)).toBe("");
  });
});
