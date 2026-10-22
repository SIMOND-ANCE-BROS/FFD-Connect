import {
  type MatchableCompetition,
  coversDay,
  folderPlaceKey,
  matchChairpersonEntry,
  placeKey,
  titleHeadKey,
} from "./chairperson-match";

const competition = (
  overrides: Partial<MatchableCompetition> & { id: string },
): MatchableCompetition => ({
  title: "Compétition",
  firstDay: "2026-10-17",
  lastDay: "2026-10-17",
  city: null,
  location: "",
  ...overrides,
});

const entry = (
  folder: string,
  title: string,
  date: string | null = "2026-10-17",
) => ({
  date,
  title,
  folder,
});

describe("matching of a TopTurnier list entry (#801, temporary)", () => {
  it("builds comparable place keys: accents, case, saint, separators", () => {
    expect(placeKey("Saint-Exemple-sur-Mer")).toBe("stexemplesurmer");
    expect(placeKey("Sainte-Époque")).toBe("steepoque");
    expect(placeKey("Élanville  Courtebois")).toBe("elanvillecourtebois");
    expect(folderPlaceKey("20261017_exempleville")).toBe("exempleville");
    expect(folderPlaceKey("20260221_villefictive-")).toBe("villefictive");
    expect(folderPlaceKey("2026AB")).toBe("ab");
    expect(titleHeadKey("Exempleville, 2eme trophée")).toBe("exempleville");
    expect(titleHeadKey("G-P de Fictiveville")).toBe("gpdefictiveville");
  });

  it("MATCHED: one competition the same day in the same town", () => {
    const result = matchChairpersonEntry(
      entry("20261017_exempleville", "Exempleville, Trophée"),
      [
        competition({ id: "a", city: "Exempleville" }),
        competition({ id: "b", city: "Autreville" }),
        competition({
          id: "c",
          city: "Exempleville",
          firstDay: "2026-10-18",
          lastDay: "2026-10-18",
        }),
      ],
    );
    expect(result).toEqual({
      status: "MATCHED",
      competitionId: "a",
      candidates: [],
    });
  });

  it("matches the town without its accents, or in the location or title", () => {
    expect(
      matchChairpersonEntry(entry("20261017_eperfictif", "Trophée"), [
        competition({ id: "a", city: "Éperfictif" }),
      ]).status,
    ).toBe("MATCHED");
    expect(
      matchChairpersonEntry(
        entry("20261017Fictiveville", "G-P de Fictiveville"),
        [
          competition({
            id: "a",
            location: "Gymnase municipal, 99999 Fictiveville",
          }),
        ],
      ).competitionId,
    ).toBe("a");
    expect(
      matchChairpersonEntry(entry("20261017_bal", "Bal"), [
        competition({ id: "a", title: "Grand Prix de Rivebelle" }),
      ]).status,
    ).toBe("NONE");
    expect(
      matchChairpersonEntry(entry("20261017rivebelle", "Rivebelle"), [
        competition({ id: "a", title: "Grand Prix de Rivebelle" }),
      ]).competitionId,
    ).toBe("a");
  });

  it("matches « Saint » spelled out against an abbreviated folder", () => {
    expect(
      matchChairpersonEntry(entry("20261017stexemplesurmer", "Critérium"), [
        competition({ id: "a", city: "Saint-Exemple-sur-Mer" }),
      ]).status,
    ).toBe("MATCHED");
  });

  it("AMBIGUOUS: several competitions the same day in the same town (ids + titles)", () => {
    const result = matchChairpersonEntry(
      entry("20261017_exempleville", "Exempleville"),
      [
        competition({ id: "a", city: "Exempleville", title: "Open A" }),
        competition({ id: "b", location: "Exempleville", title: "Open B" }),
      ],
    );
    expect(result).toEqual({
      status: "AMBIGUOUS",
      competitionId: null,
      candidates: [
        { id: "a", title: "Open A" },
        { id: "b", title: "Open B" },
      ],
    });
  });

  it("NONE: same day elsewhere, same town another day, or no date", () => {
    expect(
      matchChairpersonEntry(entry("20261017_exempleville", "Exempleville"), [
        competition({ id: "a", city: "Autreville" }),
      ]).status,
    ).toBe("NONE");
    expect(
      matchChairpersonEntry(entry("20261017_exempleville", "Exempleville"), [
        competition({
          id: "a",
          city: "Exempleville",
          firstDay: "2026-10-10",
          lastDay: "2026-10-10",
        }),
      ]).status,
    ).toBe("NONE");
    expect(
      matchChairpersonEntry(entry("x", "Exempleville", null), [
        competition({ id: "a", city: "Exempleville" }),
      ]),
    ).toEqual({ status: "NONE", competitionId: null, candidates: [] });
  });

  it("never matches on a too short or generic piece of name", () => {
    // « cr » is contained in « crozefictif » but too short to count.
    expect(
      matchChairpersonEntry(entry("20261017_cr", "CR"), [
        competition({ id: "a", city: "Crozefictif" }),
      ]).status,
    ).toBe("NONE");
    // A 3-letter town only matches exactly.
    expect(
      matchChairpersonEntry(entry("20261017_pom", "Pom"), [
        competition({ id: "a", city: "Pom" }),
        competition({ id: "b", city: "Pomeville" }),
      ]).competitionId,
    ).toBe("a");
  });

  it("covers every day of a multi-day competition", () => {
    const weekend = { firstDay: "2026-05-23", lastDay: "2026-05-24" };
    expect(coversDay(weekend, "2026-05-23")).toBe(true);
    expect(coversDay(weekend, "2026-05-24")).toBe(true);
    expect(coversDay(weekend, "2026-05-25")).toBe(false);
    expect(coversDay(weekend, "2026-05-22")).toBe(false);
    // An end before the start is read as a one-day competition.
    expect(
      coversDay(
        { firstDay: "2026-05-23", lastDay: "2026-05-01" },
        "2026-05-23",
      ),
    ).toBe(true);
    expect(
      coversDay(
        { firstDay: "2026-05-23", lastDay: "2026-05-01" },
        "2026-05-10",
      ),
    ).toBe(false);
  });
});
