import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { EXEMPLEVILLE_EXPORT } from "./__fixtures__/zip-builder";
import {
  TOPTURNIER_ROUND_LABEL,
  TopTurnierPageSource,
  archivePageSource,
  planTopTurnierImport,
  readTopTurnierExport,
} from "./topturnier-export";
import type { TopTurnierMatchableEvent } from "./topturnier-event-label";
import {
  TOPTURNIER_MAX_PAGE_BYTES,
  TOPTURNIER_MAX_TOTAL_BYTES,
  TopTurnierFormatError,
} from "./topturnier.parser";

function fixtureFiles(prefix = ""): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        files.set(
          prefix + relative(EXEMPLEVILLE_EXPORT, full).split("\\").join("/"),
          readFileSync(full),
        );
    }
  };
  walk(EXEMPLEVILLE_EXPORT);
  return files;
}

function mapSource(files: Record<string, string>): TopTurnierPageSource {
  return {
    read: (path) =>
      Promise.resolve(path in files ? Buffer.from(files[path]) : null),
  };
}

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

/** Programme of the fixture competition. */
const PROGRAM: TopTurnierMatchableEvent[] = [
  event({ id: "e-lat-adu-av" }),
  event({
    id: "e-std-sen2-int",
    category: "Standard",
    ageGroup: "Senior II",
    level: "Intermédiaire",
  }),
  event({ id: "e-lat-youth-deb", ageGroup: "Youth", level: "Débutant" }),
  event({
    id: "e-open-ya-lat",
    ageGroup: "Youth",
    ageGroups: ["Youth", "Adulte"],
    level: null,
    eventKind: "OPEN",
  }),
  event({
    id: "e-open-sen12-std",
    category: "Standard",
    ageGroup: "Senior I",
    ageGroups: ["Senior I", "Senior II"],
    level: null,
    eventKind: "OPEN",
  }),
  event({
    id: "e-solo-jun-deb",
    eventType: "SOLO",
    ageGroup: "Solo Junior 1",
    level: "Débutant",
  }),
];

describe("readTopTurnierExport", () => {
  it("reads the fixture export from an archive nested in a folder", async () => {
    const data = await readTopTurnierExport(
      archivePageSource(fixtureFiles("Export Exempleville/")),
    );
    expect(data.title).toContain("Exempleville");
    expect(
      data.events.map((e) => [e.folder, e.ranking?.rows.length ?? null]),
    ).toEqual([
      ["3-nat_adultsavancelat", 3],
      ["8-nat_sen2intermediairestd", 4],
      ["19-nat_youthadultsdebutantlat", null],
      ["25-oc_youthadultslat", 3],
      ["27-oc_seni2std", 1],
      ["47-nat_solosjuni2debutantlat", 2],
      ["60-xyz_mystery", 1],
    ]);
  });

  it("finds pages case-insensitively and accepts .html", async () => {
    const data = await readTopTurnierExport(
      archivePageSource(
        new Map([
          [
            "INDEX.HTML",
            Buffer.from('<a href="1-a/index.htm">Nat, Adults Avancé Latin</a>'),
          ],
          [
            "1-A/ERG.HTML",
            Buffer.from(
              "<table><tr><td>1.</td><td>1</td><td>A / B</td><td>C</td></tr></table>",
            ),
          ],
        ]),
      ),
    );
    expect(data.events[0].ranking?.rows).toHaveLength(1);
  });

  it("refuses an archive holding two exports", () => {
    expect(() =>
      archivePageSource(
        new Map([
          ["a/index.htm", Buffer.from("")],
          ["b/index.htm", Buffer.from("")],
        ]),
      ),
    ).toThrow(TopTurnierFormatError);
  });

  it("refuses an export without competition page or without event", async () => {
    await expect(
      readTopTurnierExport(archivePageSource(new Map())),
    ).rejects.toThrow("Page de la compétition (index.htm) introuvable");
    await expect(
      readTopTurnierExport(mapSource({ "index.htm": "<p>vide</p>" })),
    ).rejects.toThrow("Aucune épreuve trouvée");
  });

  it("refuses a page bigger than the limit", async () => {
    const big = "x".repeat(TOPTURNIER_MAX_PAGE_BYTES + 1);
    await expect(
      readTopTurnierExport(mapSource({ "index.htm": big })),
    ).rejects.toThrow("Page trop volumineuse");
  });

  it("refuses an export bigger than the total limit", async () => {
    const page = "x".repeat(TOPTURNIER_MAX_PAGE_BYTES - 10);
    const count = Math.ceil(TOPTURNIER_MAX_TOTAL_BYTES / page.length) + 1;
    const files: Record<string, string> = {
      "index.htm": Array.from(
        { length: count },
        (_, i) => `<a href="${i}-e/index.htm">E${i}</a>`,
      ).join(""),
    };
    for (let i = 0; i < count; i++) files[`${i}-e/erg.htm`] = page;
    await expect(readTopTurnierExport(mapSource(files))).rejects.toThrow(
      "Export trop volumineux",
    );
  });
});

describe("planTopTurnierImport", () => {
  it("maps every event and builds the rows of the matched ones only", async () => {
    const data = await readTopTurnierExport(archivePageSource(fixtureFiles()));
    const plan = planTopTurnierImport(data, PROGRAM);

    expect(
      plan.events.map((e) => [e.folder, e.status, e.eventId, e.exact]),
    ).toEqual([
      ["3-nat_adultsavancelat", "MATCHED", "e-lat-adu-av", true],
      ["8-nat_sen2intermediairestd", "MATCHED", "e-std-sen2-int", true],
      ["19-nat_youthadultsdebutantlat", "NO_RESULTS", "e-lat-youth-deb", false],
      ["25-oc_youthadultslat", "MATCHED", "e-open-ya-lat", true],
      ["27-oc_seni2std", "INVALID", "e-open-sen12-std", true],
      ["47-nat_solosjuni2debutantlat", "MATCHED", "e-solo-jun-deb", false],
      ["60-xyz_mystery", "UNMATCHED", null, null],
    ]);
    expect(plan.events[6].message).toBe("type d'épreuve « gala » non reconnu");
    expect(plan.events[4].message).toBe("ligne 2 : couple manquant");

    // 3 + 4 + 3 + 2 rows; the invalid event's row error is kept apart.
    expect(plan.rows).toHaveLength(12);
    expect(plan.rows[0]).toEqual({
      line: 1,
      eventId: "e-lat-adu-av",
      round: TOPTURNIER_ROUND_LABEL,
      ranking: 1,
      participant: "Alice MARTIN / Bruno DURAND",
      bib: "22",
      club: "Club Exemple A",
      licenceNumbers: [],
      status: null,
      totalParticipants: 3,
    });
    // Tie « 3.-4. »: both couples ranked 3.
    expect(
      plan.rows
        .filter((r) => r.eventId === "e-std-sen2-int")
        .map((r) => r.ranking),
    ).toEqual([1, 2, 3, 3]);
    expect(plan.errors).toEqual([{ line: 11, message: "couple manquant" }]);
    expect(plan.lineLabels.get(11)).toBe("« OC, Sen.I/II Standard », ligne 2");
    expect(plan.lineLabels.get(1)).toBe(
      "« Nat, Adults Avancé Latin », ligne 1",
    );
  });

  it("reports ambiguous events and two TopTurnier events on one event", () => {
    const ranking = {
      rows: [
        {
          position: 1,
          ranking: 1,
          rankingTo: 1,
          bib: "1",
          participant: "A / B",
          club: null,
        },
      ],
      errors: [],
    };
    const plan = planTopTurnierImport(
      {
        title: null,
        events: [
          { folder: "1-a", label: "Nat, Youth/Adults Avancé Latin", ranking },
          { folder: "2-b", label: "Nat, Adults Avancé Latin", ranking },
          { folder: "3-c", label: "Nat, Adults Avancé Standard", ranking },
          { folder: "4-d", label: "Nat, Adults Avancé Standard", ranking },
        ],
      },
      [
        event({ id: "y", ageGroup: "Youth" }),
        event({ id: "a" }),
        event({ id: "s", category: "Standard" }),
      ],
    );
    expect(plan.events.map((e) => [e.status, e.message])).toEqual([
      ["AMBIGUOUS", "2 épreuves du programme correspondent"],
      ["MATCHED", null],
      [
        "CONFLICT",
        "même épreuve du programme que « Nat, Adults Avancé Standard »",
      ],
      [
        "CONFLICT",
        "même épreuve du programme que « Nat, Adults Avancé Standard »",
      ],
    ]);
    expect(plan.rows.map((r) => r.eventId)).toEqual(["a"]);
  });

  it("reports an empty ranking page as invalid", () => {
    const plan = planTopTurnierImport(
      {
        title: null,
        events: [
          {
            folder: "1-a",
            label: "Nat, Adults Avancé Latin",
            ranking: {
              rows: [],
              errors: [{ position: 0, message: "aucune ligne de classement" }],
            },
          },
        ],
      },
      [event({ id: "a" })],
    );
    expect(plan.events[0]).toMatchObject({
      status: "INVALID",
      message: "aucune ligne de classement",
    });
    expect(plan.errors).toEqual([
      { line: 1, message: "aucune ligne de classement" },
    ]);
  });
});
