import {
  analyzeLine,
  type DeducedEvent,
  htmlToPlainText,
  mapAgeToken,
  MAX_DEDUCED_EVENTS,
  MAX_LINE_LENGTH,
  MAX_PARSED_TEXT_LENGTH,
  mergeDeducedEvents,
  normalizeForMatch,
  parseFfdEvents,
} from "./ffd-events-parser";

// ---------------------------------------------------------------------------
// Fixtures — excerpts of real FFD texts (programme descriptions and circular
// PDFs extracted with unpdf), épreuves lines only.
// ---------------------------------------------------------------------------

const ESSONNE_DESCRIPTION =
  "Compétition Nationale Classificatrices et Opens.<br />Classificatrices Couples et Solos.<br />Latine et standard <br />Débutant  / Intermédiaire  / Avancé <br />Juvéniles 1 /2 <br />Juniors 1 /2 <br />Youth /Adulte / Senior 1..2..3..4..5<br />Opens<br />Latine et standard  Couple<br />Jeunes / youth Adulte/ Senior 1 , 2 / Senior 3 / Senior 4 / Senior 5<br />Open solo Jeune latine et standard <br />Open solo youth / Adulte latine et standard <br />Open solo senior latine et stand...";

const SAPHIR_DESCRIPTION =
  "Compétitions classificatrices Couples et Solos toutes catégories et classes d âge. <br />Open Latine et standard ouvert aux couples étrangers <br />Juvéniles/ Juniors/ Youth / Adulte/ Senior 1 / Senior 2 / Senior 3 / Senior 4<br />Open Senior 5 Standard <br />Open Solo ouvert au danseurs étrangers <br />Latine et standard <br />Jeunes Juvéniles <br />Jeunes Juniors <br />Adultes<br />Seniors ";

const VAGUE_DESCRIPTIONS = [
  "Compétition 10 danses EPREUVRES CLASSIFICATRICES et OPENS ",
  "13e Coupe de danse sportive de Cergy-Pontoise<br />Compétitions classificatrives et opens ",
  "Compétition classificatrice et Opens Latines et Standards ",
  "COUPE de FRANCE LATINES ET STANDARDS ",
  "4ème Trophée du Dragon organisé par JACADANSE DRAGUIGNAN. <br />Compétitions de Danse Latines &amp; Standards <br /><br />Solo Danse <br />Couples <br />Teams<br /><br />Toutes catégories <br />  ",
  "",
];

const CHAMPIONNAT_DE_FRANCE_CIRCULAR = `Championnat de France
de Danses Latines et Standards
Épreuves programmées
Juvéniles 1 Standards
Juvéniles 2 Standards
Juniors 1 Standards
Juniors 2 Latines
Youth Standards
Espoirs Standards
Adultes Latines
Séniors 1 Latines
Séniors 2 Standards
Séniors 3 Latines
Séniors 4 Standards
Séniors 5 Standards
Solo Juniors 1 Latines
Solo Juniors 2 Latines
Solo Juvéniles Standards
Solo Adultes Latines
Solo Youths Standards
Solo Seniors Standards
2.1. Un droit de dossard obligatoire sera exigé de tous les couples et solos des catégo-
ries Youth, Adulte et Seniors s’inscrivant à toute compétition inscrite au calendrier fédé-
ral. Ce droit de dossard s’élève au maximum à 10 € (…) par couple ou solo (…)`;

const CERGY_CIRCULAR = `Compétitions nationales à points et opens
Compétitions classificatrices (1 piste) :
LATINE STANDARD
Juvénile 1 Débutant Intermédiaire Débutant
Intermédiaire
Juvénile 2 Intermédiaire Intermédiaire
Junior 1 Débutant
Intermédiaire Avancé
Débutant
Intermédiaire Avancé
Adulte Intermédiaire Avancé Intermédiaire Avancé
Senior 1
Débutant
Intermédiaire Avancé
Senior 5 Intermédiaire Avancé
Compétitions solos (1 piste) :
LATINE
Juvénile Débutant Intermédiaire Avancé
Junior 2 Intermédiaire Avancé
Senior Débutant Intermédiaire Avancé
Compétitions opens (1 piste) :
Les couples qui s’inscrivent aux opens doivent pouvoir présenter les 5 danses.
Open jeunes (4 danses) Intermédiaire, avancé, international Standard Latine
Open youths / adultes Intermédiaire, avancé, international Standard Latine
Open seniors 5 Intermédiaire, avancé, international Standard
Un droit de dossard obligatoire sera exigé de tous les couples des catégories Youth, Adulte, Senior I, Senior
Places en gradin : 12€, moins de 12 ans et licenciés FFD : 10€.`;

const BUGEY_CIRCULAR = `Épreuves classificatrices & opens - Danses Latines et Standards
LES EPREUVES
COUPLES
Débutants Niveau Intermédiaire Niveau Avancé
Classe d’âge Latines Standards Latines Standards Latines Standard
JUVENILES 1
X X
JUNIORS 2 X X X X
SENIORS III X X X X
OPENS COUPLES
Latines Standards
Open Séniors 4, 5
SOLOS
Débutants Intermédiaires Avancés
Classe d’âge Latines Standards Latines Standards Latines Standards
Youth X X X X X X
SOLO TEAMS`;

const PACA_CIRCULAR = `LE CHAMPIONNAT REGIONAL LATINES & STANDARDS
EPREUVES (piste unique) EPREUVES SOLOS (piste unique)
Tous niveaux confondus
Classe d’âge
Latines
5 danses S, CC,
R, PD, J
Standards
5 danses VA,
T, VV, SF, QS
Juveniles 1 X (3 danses) X (3 danses)
Seniors 2 X X
Seniors 5 X`;

// ---------------------------------------------------------------------------

const describeEvent = (e: DeducedEvent) =>
  [
    e.eventKind ?? "-",
    e.eventType,
    e.category,
    e.ageGroup,
    e.level ?? "-",
  ].join(" | ");

const keys = (events: DeducedEvent[]) => events.map(describeEvent);

describe("htmlToPlainText", () => {
  it("turns <br /> into lines, strips tags and decodes entities", () => {
    expect(
      htmlToPlainText(
        "Latines &amp; Standards<br />Solo<BR>Couple <b>x</b> d&#39;âge&nbsp;!&unknown;",
      ),
    ).toBe("Latines & Standards\nSolo\nCouple  x  d'âge !&unknown;");
  });

  it("breaks lines on closing block tags", () => {
    expect(htmlToPlainText("<p>Youth</p><div>Adulte</div>")).toBe(
      " Youth\n Adulte\n",
    );
  });
});

describe("normalizeForMatch", () => {
  it("lower-cases, strips accents and flattens typographic quotes", () => {
    expect(normalizeForMatch("Séniors JUVÉNILES Classe d’âge")).toBe(
      "seniors juveniles classe d'age",
    );
  });
});

describe("analyzeLine", () => {
  const ages = (line: string) =>
    analyzeLine(normalizeForMatch(line)).ages.map(
      (a) => `${a.keyword}:${a.numbers.join(",")}`,
    );

  it("reads number lists after an age class", () => {
    expect(ages("Juniors 1 /2")).toEqual(["junior:1,2"]);
    expect(ages("Senior 1 , 2 / Senior 3")).toEqual(["senior:1,2", "senior:3"]);
    expect(ages("Seniors I X X")).toEqual(["senior:1"]);
    expect(ages("Senior 1 et 2")).toEqual(["senior:1,2"]);
  });

  it("expands ranges written with '..' or 'à'", () => {
    expect(ages("Senior 1..5")).toEqual(["senior:1,2,3,4,5"]);
    expect(ages("Senior 1..2..3..4..5")).toEqual(["senior:1,2,3,4,5"]);
    expect(ages("Seniors 2 à 4")).toEqual(["senior:2,3,4"]);
  });

  it("does not take a dance count for an age class number", () => {
    expect(ages("Open jeunes (4 danses)")).toEqual(["jeunes:"]);
    expect(ages("Juveniles 1 X (3 danses)")).toEqual(["juvenile:1"]);
  });

  it("recognises every vocabulary family", () => {
    const info = analyzeLine(
      normalizeForMatch(
        "Open Solo Couple Latines Standards 10 danses Déb. Inter. Avancés International classificatrice championnat",
      ),
    );
    expect(info.categories).toEqual(["Latin", "Standard", "Ten Dance"]);
    expect(info.levels).toEqual([
      "Débutant",
      "Intermédiaire",
      "Avancé",
      "International",
    ]);
    expect(info.kinds).toEqual(["CLASSIFICATRICE", "OPEN", "MAJEURE"]);
    expect(info.types).toEqual(["SOLO", "COUPLE"]);
    expect(info.unknownWords).toBe(0);
  });

  it("maps Novice to Débutant and ignores 'inter-régional'", () => {
    expect(
      analyzeLine(normalizeForMatch("catégories Novice et Intermédiaire"))
        .levels,
    ).toEqual(["Débutant", "Intermédiaire"]);
    expect(
      analyzeLine(normalizeForMatch("Championnat inter-régional")).levels,
    ).toEqual([]);
  });

  it("counts prose words and flags team lines", () => {
    expect(
      analyzeLine(
        normalizeForMatch(
          "Les couples appartenant au niveau débutant qui souhaitent participer aux opens, devront être titulaires",
        ),
      ).unknownWords,
    ).toBeGreaterThan(4);
    expect(analyzeLine("solo danse team").team).toBe(true);
  });
});

describe("mapAgeToken", () => {
  it("maps couple classes to the canonical names", () => {
    expect(
      mapAgeToken({ keyword: "juvenile", numbers: [] }, "COUPLE", true),
    ).toEqual(["Juvénile I", "Juvénile II"]);
    expect(
      mapAgeToken({ keyword: "junior", numbers: [2] }, "COUPLE", true),
    ).toEqual(["Junior II"]);
    expect(
      mapAgeToken({ keyword: "senior", numbers: [] }, "COUPLE", false),
    ).toEqual(["Senior I", "Senior II", "Senior III", "Senior IV", "Senior V"]);
    expect(
      mapAgeToken({ keyword: "senior", numbers: [9] }, "COUPLE", false),
    ).toHaveLength(5);
    expect(
      mapAgeToken({ keyword: "youth", numbers: [] }, "COUPLE", false),
    ).toEqual(["Youth"]);
    expect(
      mapAgeToken({ keyword: "adulte", numbers: [] }, "COUPLE", false),
    ).toEqual(["Adulte"]);
  });

  it("maps solo classes to the canonical names", () => {
    expect(
      mapAgeToken({ keyword: "juvenile", numbers: [1] }, "SOLO", true),
    ).toEqual(["Solo Juvénile"]);
    expect(
      mapAgeToken({ keyword: "junior", numbers: [] }, "SOLO", true),
    ).toEqual(["Solo Junior 1", "Solo Junior 2"]);
    expect(
      mapAgeToken({ keyword: "senior", numbers: [3] }, "SOLO", false),
    ).toEqual(["Solo Senior"]);
    expect(
      mapAgeToken({ keyword: "youth", numbers: [] }, "SOLO", false),
    ).toEqual(["Solo Youth"]);
    expect(
      mapAgeToken({ keyword: "adulte", numbers: [] }, "SOLO", false),
    ).toEqual(["Solo Adulte"]);
  });

  it("expands 'Jeunes' only when no juvenile/junior is named", () => {
    expect(
      mapAgeToken({ keyword: "jeunes", numbers: [] }, "COUPLE", false),
    ).toEqual(["Juvénile I", "Juvénile II", "Junior I", "Junior II"]);
    expect(
      mapAgeToken({ keyword: "jeunes", numbers: [] }, "SOLO", false),
    ).toEqual(["Solo Juvénile", "Solo Junior 1", "Solo Junior 2"]);
    expect(
      mapAgeToken({ keyword: "jeunes", numbers: [] }, "COUPLE", true),
    ).toEqual([]);
  });

  it("drops Espoir, which has no age class in the app", () => {
    expect(
      mapAgeToken({ keyword: "espoir", numbers: [] }, "COUPLE", false),
    ).toEqual([]);
  });
});

describe("parseFfdEvents", () => {
  it("returns nothing for vague programmes (no age class)", () => {
    for (const text of VAGUE_DESCRIPTIONS) {
      expect(parseFfdEvents(text)).toEqual([]);
    }
  });

  it("deduces classificatrices and opens from a detailed description", () => {
    const events = keys(parseFfdEvents(ESSONNE_DESCRIPTION));

    // Classificatrices couples + solos, levels filtered by the regulation.
    expect(events).toEqual(
      expect.arrayContaining([
        "CLASSIFICATRICE | COUPLE | Latin | Juvénile I | Débutant",
        "CLASSIFICATRICE | COUPLE | Standard | Junior II | Avancé",
        "CLASSIFICATRICE | COUPLE | Latin | Senior V | Intermédiaire",
        "CLASSIFICATRICE | SOLO | Latin | Solo Juvénile | Débutant",
        "CLASSIFICATRICE | SOLO | Standard | Solo Senior | Avancé",
        "OPEN | COUPLE | Latin | Junior I | -",
        "OPEN | COUPLE | Standard | Senior III | -",
        "OPEN | SOLO | Latin | Solo Junior 2 | -",
        "OPEN | SOLO | Standard | Solo Adulte | -",
      ]),
    );
    // Juvénile classes have no "Avancé" level; Adulte has no "Débutant".
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Juvénile I | Avancé",
    );
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Adulte | Débutant",
    );
    // Opens group levels.
    expect(
      events.filter((e) => e.startsWith("OPEN") && !e.endsWith("| -")),
    ).toEqual([]);
    // Deduplicated.
    expect(new Set(events).size).toBe(events.length);
  });

  it("handles 'Jeunes' qualifiers and per-line specialities", () => {
    const events = keys(parseFfdEvents(SAPHIR_DESCRIPTION));
    expect(events).toEqual(
      expect.arrayContaining([
        "OPEN | COUPLE | Latin | Senior IV | -",
        "OPEN | COUPLE | Standard | Senior V | -",
        "OPEN | SOLO | Latin | Solo Juvénile | -",
        "OPEN | SOLO | Standard | Solo Senior | -",
      ]),
    );
    expect(events).not.toContain("OPEN | COUPLE | Latin | Senior V | -");
    // "Jeunes Juvéniles" must not expand to juniors.
    expect(
      events.filter((e) => e.includes("SOLO") && e.includes("Junior")),
    ).toHaveLength(4);
  });

  it("reads the championship list and ignores the bib-fee rule", () => {
    const events = keys(parseFfdEvents(CHAMPIONNAT_DE_FRANCE_CIRCULAR));
    expect(events).toEqual([
      "MAJEURE | COUPLE | Standard | Juvénile I | -",
      "MAJEURE | COUPLE | Standard | Juvénile II | -",
      "MAJEURE | COUPLE | Standard | Junior I | -",
      "MAJEURE | COUPLE | Latin | Junior II | -",
      "MAJEURE | COUPLE | Standard | Youth | -",
      "MAJEURE | COUPLE | Latin | Adulte | -",
      "MAJEURE | COUPLE | Latin | Senior I | -",
      "MAJEURE | COUPLE | Standard | Senior II | -",
      "MAJEURE | COUPLE | Latin | Senior III | -",
      "MAJEURE | COUPLE | Standard | Senior IV | -",
      "MAJEURE | COUPLE | Standard | Senior V | -",
      "MAJEURE | SOLO | Latin | Solo Junior 1 | -",
      "MAJEURE | SOLO | Latin | Solo Junior 2 | -",
      "MAJEURE | SOLO | Standard | Solo Juvénile | -",
      "MAJEURE | SOLO | Latin | Solo Adulte | -",
      "MAJEURE | SOLO | Standard | Solo Youth | -",
      "MAJEURE | SOLO | Standard | Solo Senior | -",
    ]);
  });

  it("reads a flattened classificatrice table with wrapped cells", () => {
    const events = keys(parseFfdEvents(CERGY_CIRCULAR));
    expect(events).toEqual(
      expect.arrayContaining([
        // Wrapped "Juvénile 1 … Débutant / Intermédiaire" cell.
        "CLASSIFICATRICE | COUPLE | Latin | Juvénile I | Intermédiaire",
        "CLASSIFICATRICE | COUPLE | Standard | Juvénile I | Débutant",
        // "Senior 1" alone, levels on the next lines.
        "CLASSIFICATRICE | COUPLE | Latin | Senior I | Intermédiaire",
        "CLASSIFICATRICE | COUPLE | Standard | Senior I | Avancé",
        // Solo section keeps the classificatrice nature.
        "CLASSIFICATRICE | SOLO | Latin | Solo Juvénile | Débutant",
        "CLASSIFICATRICE | SOLO | Latin | Solo Junior 2 | Avancé",
        "CLASSIFICATRICE | SOLO | Latin | Solo Senior | Débutant",
        // Opens section is couple again.
        "OPEN | COUPLE | Standard | Juvénile II | -",
        "OPEN | COUPLE | Latin | Junior I | -",
        "OPEN | COUPLE | Latin | Adulte | -",
        "OPEN | COUPLE | Standard | Senior V | -",
      ]),
    );
    // Senior I has no Débutant level; the levelless placeholder of
    // "Senior 1" was superseded by its wrapped levels.
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Senior I | Débutant",
    );
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Senior I | -",
    );
    expect(events).not.toContain("OPEN | COUPLE | Latin | Senior V | -");
    expect(events.some((e) => e.includes("SOLO | Standard"))).toBe(false);
  });

  it("uses a table's level header and infers classificatrices", () => {
    const events = keys(parseFfdEvents(BUGEY_CIRCULAR));
    expect(events).toEqual(
      expect.arrayContaining([
        "CLASSIFICATRICE | COUPLE | Latin | Juvénile I | Débutant",
        "CLASSIFICATRICE | COUPLE | Standard | Junior II | Avancé",
        "CLASSIFICATRICE | COUPLE | Latin | Senior III | Débutant",
        "OPEN | COUPLE | Latin | Senior IV | -",
        "OPEN | COUPLE | Standard | Senior V | -",
        // "SOLOS" after the opens: back to classificatrices.
        "CLASSIFICATRICE | SOLO | Standard | Solo Youth | Avancé",
      ]),
    );
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Juvénile I | Avancé",
    );
  });

  it("merges speciality headers split on several lines", () => {
    const events = keys(parseFfdEvents(PACA_CIRCULAR));
    expect(events).toEqual(
      expect.arrayContaining([
        "MAJEURE | COUPLE | Latin | Juvénile I | -",
        "MAJEURE | COUPLE | Standard | Juvénile I | -",
        // Numbered seniors are couple-only even under a merged solo header.
        "MAJEURE | COUPLE | Latin | Senior II | -",
        "MAJEURE | COUPLE | Standard | Senior V | -",
      ]),
    );
    expect(events.some((e) => e.includes("Solo Senior"))).toBe(false);
  });

  it("falls back to Latin + Standard when no speciality is named", () => {
    expect(keys(parseFfdEvents("Opens<br />Youth"))).toEqual([
      "OPEN | COUPLE | Latin | Youth | -",
      "OPEN | COUPLE | Standard | Youth | -",
    ]);
  });

  it("uses specialities named anywhere in the document", () => {
    expect(keys(parseFfdEvents("Adulte<br />Compétition 10 danses"))).toEqual([
      "- | COUPLE | Ten Dance | Adulte | -",
    ]);
  });

  it("emits nothing for team lines", () => {
    expect(parseFfdEvents("Solo Danse Team Juniors Latine")).toEqual([]);
  });

  it("keeps the nature undecided when a row names two natures", () => {
    expect(
      keys(parseFfdEvents("Classificatrices et opens Youth Latine")),
    ).toEqual(["- | COUPLE | Latin | Youth | -"]);
  });

  it("drops classificatrice levels the age class cannot dance", () => {
    expect(
      parseFfdEvents("Classificatrices Latine<br />Juvénile 1 Avancé"),
    ).toEqual([]);
  });

  it("starts a new table when levels follow a speciality header", () => {
    const events = keys(
      parseFfdEvents(
        "Classificatrices<br />Youth Débutant<br />Latine<br />Avancé<br />Adulte",
      ),
    );
    expect(events).toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Adulte | Avancé",
    );
    expect(events).not.toContain(
      "CLASSIFICATRICE | COUPLE | Latin | Youth | Avancé",
    );
  });

  it(`caps the output at ${MAX_DEDUCED_EVENTS} events`, () => {
    const levels = "Débutant Intermédiaire Avancé International";
    const line = `Classificatrices Couples et Solos Latine Standard 10 danses Juvéniles Juniors Youth Adulte Seniors ${levels}`;
    const text = Array.from({ length: 5 }, () => line).join("\n");
    const events = parseFfdEvents(text);
    expect(events.length).toBeLessThanOrEqual(MAX_DEDUCED_EVENTS);
    expect(events.length).toBeGreaterThan(50);
  });
});

describe("mergeDeducedEvents", () => {
  const event = (
    ageGroup: string,
    eventType: "COUPLE" | "SOLO" = "COUPLE",
  ): DeducedEvent => ({
    category: "Latin",
    ageGroup,
    eventType,
    level: null,
    eventKind: "OPEN",
  });

  it("keeps the circular and adds only the age classes it does not cover", () => {
    const merged = mergeDeducedEvents(
      [event("Youth"), event("Solo Youth", "SOLO")],
      [event("Youth"), event("Adulte"), event("Solo Youth", "SOLO")],
    );
    expect(merged.map((e) => e.ageGroup)).toEqual([
      "Youth",
      "Solo Youth",
      "Adulte",
    ]);
  });

  it("returns the secondary events when the primary source is empty", () => {
    expect(mergeDeducedEvents([], [event("Adulte")])).toEqual([
      event("Adulte"),
    ]);
  });

  it("never exceeds the cap", () => {
    const primary = Array.from({ length: MAX_DEDUCED_EVENTS }, (_, i) =>
      event(`A${i}`),
    );
    expect(mergeDeducedEvents(primary, [event("Other")])).toHaveLength(
      MAX_DEDUCED_EVENTS,
    );
  });
});

describe("hostile input", () => {
  // Each case is quadratic (or worse) with a naive pattern: tens of seconds
  // on 50k characters. Linear patterns finish in a few milliseconds.
  const fast = (run: () => unknown) => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it.each([
    ["age class + separators", `senior${" ,".repeat(25_000)}x`],
    ["age class + 'a' separators", `senior ${"a ".repeat(25_000)}x`],
    ["age class + dots", `juniors${".".repeat(50_000)}`],
    ["unknown words", "abc ".repeat(12_500)],
  ])("analyses a pathological line linearly (%s)", (_label, line) => {
    expect(fast(() => analyzeLine(line))).toBeLessThan(500);
  });

  it.each([
    ["unclosed tags", "<".repeat(50_000)],
    ["unterminated entity", `&${"a".repeat(50_000)}`],
    ["unterminated numeric entity", `&#${"1".repeat(50_000)}`],
    ["unclosed br", `<br${" ".repeat(50_000)}`],
  ])("strips HTML linearly (%s)", (_label, raw) => {
    expect(fast(() => htmlToPlainText(raw))).toBeLessThan(500);
  });

  it("only reads the first MAX_PARSED_TEXT_LENGTH characters", () => {
    const padding = "x\n".repeat(MAX_PARSED_TEXT_LENGTH);
    let events: unknown[] = [];
    const elapsed = fast(() => {
      events = parseFfdEvents(`${padding}Opens Latine\nYouth`);
    });
    expect(events).toEqual([]);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("ignores lines longer than MAX_LINE_LENGTH", () => {
    const longLine = `Opens Latine Youth ${"x".repeat(MAX_LINE_LENGTH)}`;
    expect(parseFfdEvents(longLine)).toEqual([]);
    expect(parseFfdEvents("Opens Latine Youth")).toHaveLength(1);
  });
});
