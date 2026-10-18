import {
  TopTurnierMatchableEvent,
  matchTopTurnierEvent,
  parseTopTurnierLabel,
} from "./topturnier-event-label";

function descriptor(label: string) {
  const parsed = parseTopTurnierLabel(label);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptor;
}

describe("parseTopTurnierLabel", () => {
  it.each([
    [
      "Nat, Adults Avancé Latin",
      {
        kind: "CLASSIFICATRICE",
        solo: false,
        ageGroups: ["Adulte"],
        level: "Avancé",
        discipline: "Latin",
      },
    ],
    [
      "Nat, Sen.II Intermédiaire Standard",
      {
        kind: "CLASSIFICATRICE",
        solo: false,
        ageGroups: ["Senior II"],
        level: "Intermédiaire",
        discipline: "Standard",
      },
    ],
    [
      "Nat, Youth/Adults Débutant Latin",
      {
        kind: "CLASSIFICATRICE",
        solo: false,
        ageGroups: ["Youth", "Adulte"],
        level: "Débutant",
        discipline: "Latin",
      },
    ],
    [
      "OC, Juv.I/II/Jun.I/II Latin",
      {
        kind: "OPEN",
        solo: false,
        ageGroups: ["Juvénile I", "Juvénile II", "Junior I", "Junior II"],
        level: null,
        discipline: "Latin",
      },
    ],
    [
      "OC, Sen.III/IV Standard",
      {
        kind: "OPEN",
        solo: false,
        ageGroups: ["Senior III", "Senior IV"],
        level: null,
        discipline: "Standard",
      },
    ],
    [
      "OC, Sen.I/II Standard",
      {
        kind: "OPEN",
        solo: false,
        ageGroups: ["Senior I", "Senior II"],
        level: null,
        discipline: "Standard",
      },
    ],
    [
      "Nat, Sen. Débutant Latin",
      {
        kind: "CLASSIFICATRICE",
        solo: false,
        ageGroups: [
          "Senior I",
          "Senior II",
          "Senior III",
          "Senior IV",
          "Senior V",
        ],
        level: "Débutant",
        discipline: "Latin",
      },
    ],
    [
      "Nat, Sen.V Avancé Standard",
      {
        kind: "CLASSIFICATRICE",
        solo: false,
        ageGroups: ["Senior V"],
        level: "Avancé",
        discipline: "Standard",
      },
    ],
    [
      "Nat, Solos Juv. Intermédiaire Latin",
      {
        kind: "CLASSIFICATRICE",
        solo: true,
        ageGroups: ["Solo Juvénile"],
        level: "Intermédiaire",
        discipline: "Latin",
      },
    ],
    [
      "Nat, Solos Jun.I Intermédiaire Standard",
      {
        kind: "CLASSIFICATRICE",
        solo: true,
        ageGroups: ["Solo Junior 1"],
        level: "Intermédiaire",
        discipline: "Standard",
      },
    ],
    [
      "Nat, Solos Jun.I/II Avancé Latin",
      {
        kind: "CLASSIFICATRICE",
        solo: true,
        ageGroups: ["Solo Junior 1", "Solo Junior 2"],
        level: "Avancé",
        discipline: "Latin",
      },
    ],
    [
      "Nat, Solos Sen. Avancé Standard",
      {
        kind: "CLASSIFICATRICE",
        solo: true,
        ageGroups: ["Solo Senior"],
        level: "Avancé",
        discipline: "Standard",
      },
    ],
    [
      "OC, Solos Youth/Adults - Standard",
      {
        kind: "OPEN",
        solo: true,
        ageGroups: ["Solo Youth", "Solo Adulte"],
        level: null,
        discipline: "Standard",
      },
    ],
    [
      "OC, Solos Juv.I/II/Jun.I/II - Latin",
      {
        kind: "OPEN",
        solo: true,
        ageGroups: ["Solo Juvénile", "Solo Junior 1", "Solo Junior 2"],
        level: null,
        discipline: "Latin",
      },
    ],
    [
      "Adults International Ten Dance",
      {
        kind: null,
        solo: false,
        ageGroups: ["Adulte"],
        level: "International",
        discipline: "Ten Dance",
      },
    ],
    [
      "Open, Junior 2 Lat",
      {
        kind: "OPEN",
        solo: false,
        ageGroups: ["Junior II"],
        level: null,
        discipline: "Latin",
      },
    ],
  ])("reads « %s »", (label, expected) => {
    expect(descriptor(label)).toEqual(expected);
  });

  it.each([
    ["Gala, Formation Show", "type d'épreuve « gala » non reconnu"],
    ["Nat, Adults Avancé Salsa", "spécialité non reconnue"],
    ["Nat, Avancé Latin", "classe d'âge absente"],
    ["Nat, Adults Expert Latin", "classe d'âge non reconnue"],
    ["Nat, Sen.VI Avancé Latin", "classe d'âge non reconnue"],
    ["Nat, Juv.III Latin", "classe d'âge non reconnue"],
    ["Nat, Solos Sen.VI Latin", "classe d'âge non reconnue"],
    ["Nat, Solos Juv.III Latin", "classe d'âge non reconnue"],
    ["Nat, II/Adults Latin", "classe d'âge non reconnue"],
    ["Nat, Adults/xyz Latin", "classe d'âge non reconnue"],
    ["Nat, Adults.X Latin", "classe d'âge non reconnue"],
  ])("does not guess « %s »", (label, reason) => {
    expect(parseTopTurnierLabel(label)).toEqual({ ok: false, reason });
  });

  // Every event label of a real national competition export (labels only).
  it.each([
    "Nat, Jun.I/II Intermédiaire Latin",
    "Nat, Adults Intermédiaire Latin",
    "Nat, Adults Intermédiaire Standard",
    "Nat, Adults Avancé Latin",
    "Nat, Adults Avancé Standard",
    "Nat, Sen.I Intermédiaire Latin",
    "Nat, Sen.I Intermédiaire Standard",
    "Nat, Sen.I Avancé Standard",
    "Nat, Sen.II Intermédiaire Latin",
    "Nat, Sen.II Intermédiaire Standard",
    "Nat, Sen.II Avancé Latin",
    "Nat, Sen.II Avancé Standard",
    "Nat, Sen.III Intermédiaire Latin",
    "Nat, Sen.III Intermédiaire Standard",
    "Nat, Sen.III Avancé Latin",
    "Nat, Sen.III Avancé Standard",
    "Nat, Sen.IV Intermédiaire Standard",
    "Nat, Sen.IV Avancé Latin",
    "Nat, Sen.IV Avancé Standard",
    "Nat, Sen.V Avancé Standard",
    "Nat, Youth/Adults Débutant Latin",
    "Nat, Youth/Adults Débutant Standard",
    "Nat, Sen. Débutant Latin",
    "Nat, Sen. Débutant Standard",
    "OC, Juv.I/II/Jun.I/II Latin",
    "OC, Juv.I/II/Jun.I/II Standard",
    "OC, Youth/Adults Latin",
    "OC, Youth/Adults Standard",
    "OC, Sen.I/II Latin",
    "OC, Sen.I/II Standard",
    "OC, Sen.III/IV Latin",
    "OC, Sen.III/IV Standard",
    "OC, Sen.V Standard",
    "Nat, Solos Juv. Intermédiaire Latin",
    "Nat, Solos Juv. Intermédiaire Standard",
    "Nat, Solos Jun.I Intermédiaire Latin",
    "Nat, Solos Jun.I Intermédiaire Standard",
    "Nat, Solos Jun.I/II Intermédiaire Latin",
    "Nat, Solos Jun.I/II Intermédiaire Standard",
    "Nat, Solos Jun.I/II Avancé Latin",
    "Nat, Solos Youth Intermédiaire Latin",
    "Nat, Solos Adults Avancé Latin",
    "Nat, Solos Sen. Intermédiaire Latin",
    "Nat, Solos Sen. Intermédiaire Standard",
    "Nat, Solos Sen. Avancé Latin",
    "Nat, Solos Sen. Avancé Standard",
    "Nat, Solos Juv. Débutant Latin",
    "Nat, Solos Juv. Débutant Standard",
    "Nat, Solos Jun.I/II Débutant Latin",
    "Nat, Solos Jun.I/II Débutant Standard",
    "Nat, Solos Youth/Adults Débutant Latin",
    "Nat, Solos Sen. Débutant Latin",
    "OC, Solos Juv.I/II/Jun.I/II - Latin",
    "OC, Solos Juv.I/II/Jun.I/II - Standard",
    "OC, Solos Youth/Adults - Latin",
    "OC, Solos Youth/Adults - Standard",
  ])("understands the real label « %s »", (label) => {
    expect(parseTopTurnierLabel(label).ok).toBe(true);
  });
});

function event(
  overrides: Partial<TopTurnierMatchableEvent> & { id: string },
): TopTurnierMatchableEvent {
  return {
    category: "Latin",
    ageGroup: "Adulte",
    ageGroups: [],
    eventType: "COUPLE",
    level: "Avancé",
    eventKind: "CLASSIFICATRICE",
    ...overrides,
  };
}

describe("matchTopTurnierEvent", () => {
  const program = [
    event({ id: "lat-adu-av" }),
    event({ id: "std-adu-av", category: "Standard" }),
    event({ id: "lat-adu-int", level: "Intermédiaire" }),
    event({
      id: "open-sen12-std",
      category: "Standard",
      ageGroup: "Senior I",
      ageGroups: ["Senior II", "Senior I"],
      level: null,
      eventKind: "OPEN",
    }),
    event({ id: "lat-youth-deb", ageGroup: "Youth", level: "Débutant" }),
    event({
      id: "solo-jun-deb",
      eventType: "SOLO",
      ageGroup: "Solo Junior 1",
      ageGroups: [],
      level: "Débutant",
    }),
  ];

  it("matches on the same age groups (exact)", () => {
    expect(
      matchTopTurnierEvent(descriptor("Nat, Adults Avancé Latin"), program),
    ).toEqual({ kind: "match", eventId: "lat-adu-av", exact: true });
    expect(
      matchTopTurnierEvent(descriptor("OC, Sen.I/II Standard"), program),
    ).toEqual({ kind: "match", eventId: "open-sen12-std", exact: true });
  });

  it("matches a combined TopTurnier event on its only class in the programme", () => {
    expect(
      matchTopTurnierEvent(
        descriptor("Nat, Youth/Adults Débutant Latin"),
        program,
      ),
    ).toEqual({ kind: "match", eventId: "lat-youth-deb", exact: false });
    expect(
      matchTopTurnierEvent(
        descriptor("Nat, Solos Jun.I/II Débutant Latin"),
        program,
      ),
    ).toEqual({ kind: "match", eventId: "solo-jun-deb", exact: false });
  });

  it("does not match across discipline, level, type or kind", () => {
    const unknown = {
      kind: "unknown",
      reason: "aucune épreuve correspondante dans le programme",
    };
    expect(
      matchTopTurnierEvent(
        descriptor("Nat, Adults Débutant Standard"),
        program,
      ),
    ).toEqual(unknown);
    expect(
      matchTopTurnierEvent(
        descriptor("Nat, Solos Adults Avancé Latin"),
        program,
      ),
    ).toEqual(unknown);
    expect(
      matchTopTurnierEvent(descriptor("OC, Adults Avancé Latin"), program),
    ).toEqual(unknown);
    // A split TopTurnier event never lands on a wider programme event.
    expect(
      matchTopTurnierEvent(descriptor("OC, Sen.I Standard"), program),
    ).toEqual(unknown);
  });

  it("accepts any kind when the programme event has none", () => {
    expect(
      matchTopTurnierEvent(descriptor("OC, Adults Avancé Latin"), [
        event({ id: "x", eventKind: null }),
      ]),
    ).toEqual({ kind: "match", eventId: "x", exact: true });
  });

  it("never picks among several candidates", () => {
    expect(
      matchTopTurnierEvent(descriptor("Nat, Adults Avancé Latin"), [
        event({ id: "a" }),
        event({ id: "b" }),
      ]),
    ).toEqual({ kind: "ambiguous", count: 2 });
    expect(
      matchTopTurnierEvent(descriptor("Nat, Youth/Adults Avancé Latin"), [
        event({ id: "a", ageGroup: "Youth" }),
        event({ id: "b", ageGroup: "Adulte" }),
      ]),
    ).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("ignores programme events without age group", () => {
    expect(
      matchTopTurnierEvent(descriptor("Nat, Adults Avancé Latin"), [
        event({ id: "a", ageGroup: null }),
      ]).kind,
    ).toBe("unknown");
  });
});
