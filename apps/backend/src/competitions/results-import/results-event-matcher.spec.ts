import {
  buildEventNameMatcher,
  normalizeEventName,
} from "./results-event-matcher";

describe("results event matcher (#690)", () => {
  const events = [
    { id: "lat-adv", category: "Latin", ageGroup: "Adultes", level: "Avancé" },
    {
      id: "lat-deb",
      category: "Latin",
      ageGroup: "Adultes",
      level: "Débutant",
    },
    { id: "lat-jun", category: "Latin", ageGroup: "Juniors", level: null },
    {
      id: "lat-jun-int",
      category: "Latin",
      ageGroup: "Juniors",
      level: "International",
    },
    { id: "ten", category: "Ten Dance", ageGroup: "Adultes", level: null },
    { id: "odd", category: null, ageGroup: null, level: null },
  ];
  const match = buildEventNameMatcher(events);

  it("normalises accents, case and punctuation", () => {
    expect(normalizeEventName("  Latines – ADULTES / Avancé ")).toBe(
      "latines adultes avance",
    );
  });

  it("matches the French label or the stored discipline, with the level", () => {
    expect(match("Latines Adultes Avancé")).toEqual({
      kind: "match",
      eventId: "lat-adv",
    });
    expect(match("latin-adultes-debutant")).toEqual({
      kind: "match",
      eventId: "lat-deb",
    });
    expect(match("10 danses adultes")).toEqual({
      kind: "match",
      eventId: "ten",
    });
    expect(match("Ten Dance Adultes")).toEqual({
      kind: "match",
      eventId: "ten",
    });
  });

  it("prefers the full name: an event without level beats a homonym with one", () => {
    expect(match("Latines Juniors")).toEqual({
      kind: "match",
      eventId: "lat-jun",
    });
  });

  it("refuses a name without level shared by several events", () => {
    expect(match("Latines Adultes")).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("reports an unknown or empty name", () => {
    expect(match("Rock Seniors")).toEqual({ kind: "unknown" });
    expect(match(" - ")).toEqual({ kind: "unknown" });
  });
});
