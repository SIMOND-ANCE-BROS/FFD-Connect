import { readFileSync } from "fs";
import { join } from "path";
import { MAX_RESULT_IMPORT_ROWS, parseResultsCsv } from "./results-csv.parser";

const FIXTURE = readFileSync(
  join(__dirname, "../../../test/fixtures/results-import/finale-latines.csv"),
  "utf8",
);

describe("parseResultsCsv (#652)", () => {
  it("parses the published ranking fixture (`;`, quotes, accents, multi-line field)", () => {
    const { rows, errors } = parseResultsCsv(FIXTURE);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      line: 2,
      eventId: "ev-latin",
      round: "Finale",
      ranking: 1,
      participant: "Alpha / Bravo",
      bib: "12",
      club: "Club Fictif A",
      licenceNumbers: ["100001", "100002"],
      status: null,
      totalParticipants: 6,
    });
    // `;` and escaped quotes inside a quoted field; licences split on `|`.
    expect(rows[1].participant).toBe('Charlie / Delta; dit "CD"');
    expect(rows[1].licenceNumbers).toEqual(["100003", "100004"]);
    expect(rows[2].licenceNumbers).toEqual([]);
    expect(rows[2].bib).toBe("31");
    // A quoted field spanning two lines keeps the line the record starts on.
    expect(rows[3]).toMatchObject({
      line: 5,
      round: "1/2 finale",
      ranking: 7,
      club: "Club\nFictif C",
      status: "ELIMINATED",
      totalParticipants: 12,
    });
  });

  it("accepts `,` as separator, CRLF line ends, a BOM and English headers", () => {
    const csv =
      "﻿eventId,round,ranking,participant\r\nev-1,Final,2,  Kilo   /  Lima \r\n";
    const { rows, errors } = parseResultsCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        eventId: "ev-1",
        round: "Final",
        ranking: 2,
        participant: "Kilo / Lima",
        bib: null,
        club: null,
        licenceNumbers: [],
        status: null,
        totalParticipants: null,
      },
    ]);
  });

  it("separates licence numbers by `|` only, trims and deduplicates them (L1)", () => {
    const csv =
      "epreuve;tour;classement;couple;licences\nev;F;1;A / B; 111 | AB 12/3-4 |111\n";
    expect(parseResultsCsv(csv).rows[0].licenceNumbers).toEqual([
      "111",
      "AB 12/3-4",
    ]);
  });

  it("refuses a licence number that is not shaped like one or longer than 32 characters (L1)", () => {
    const header = "epreuve;tour;classement;couple;licences";
    for (const licences of ["*123", "-12", "1".repeat(33), "1|2|3|4|5"]) {
      const { rows, errors } = parseResultsCsv(
        `${header}\nev;F;1;A / B;${licences}\n`,
      );
      expect(rows).toEqual([]);
      expect(errors).toEqual([
        { line: 2, message: "numéros de licence invalides" },
      ]);
    }
    expect(
      parseResultsCsv(`${header}\nev;F;1;A / B;${"1".repeat(32)}\n`).errors,
    ).toEqual([]);
  });

  it("ignores prototype keys used as headers (L7)", () => {
    const { errors } = parseResultsCsv(
      "__proto__;constructor;toString;hasOwnProperty\nx;y;z;w\n",
    );
    expect(errors).toEqual([
      {
        line: 1,
        message:
          "Colonnes obligatoires absentes : eventId, round, ranking, participant",
      },
    ]);
  });

  it("reports an empty file", () => {
    expect(parseResultsCsv("")).toEqual({
      rows: [],
      errors: [{ line: 1, message: "Fichier vide" }],
    });
  });

  it("reports missing required columns", () => {
    const { rows, errors } = parseResultsCsv("epreuve;tour\nev;Finale\n");
    expect(rows).toEqual([]);
    expect(errors).toEqual([
      {
        line: 1,
        message: "Colonnes obligatoires absentes : ranking, participant",
      },
    ]);
  });

  it("reports a header without data lines", () => {
    expect(
      parseResultsCsv("epreuve;tour;classement;couple\n\n").errors,
    ).toEqual([{ line: 1, message: "Aucune ligne de résultat" }]);
  });

  it("refuses more lines than the cap", () => {
    const lines = Array.from(
      { length: MAX_RESULT_IMPORT_ROWS + 1 },
      (_, i) => `ev;F;${i + 1};C${i}`,
    );
    const { rows, errors } = parseResultsCsv(
      ["epreuve;tour;classement;couple", ...lines].join("\n"),
    );
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("Trop de lignes");
  });

  it("reports every invalid field of a line with its line number", () => {
    const csv = [
      "epreuve;tour;classement;couple;participants;licences;dossard;club;statut",
      `;;0;;abc;1|2|3|4|5;${"x".repeat(81)};${"c".repeat(201)};${"s".repeat(81)}`,
      `ev;${"r".repeat(81)};1;${"n".repeat(201)};;${"9".repeat(81)};;;`,
      "ev;Finale;1.5;A / B",
    ].join("\n");
    const { rows, errors } = parseResultsCsv(csv);

    expect(rows).toEqual([]);
    expect(errors).toEqual([
      {
        line: 2,
        message:
          "épreuve manquante, tour manquant, classement invalide (entier ≥ 1 attendu), couple manquant, dossard trop long, club trop long, statut trop long, nombre de participants invalide, numéros de licence invalides",
      },
      {
        line: 3,
        message:
          "tour trop long, libellé du couple trop long, numéros de licence invalides",
      },
      { line: 4, message: "classement invalide (entier ≥ 1 attendu)" },
    ]);
  });

  it("keeps valid lines next to invalid ones (the caller rejects the file)", () => {
    const csv = "epreuve;tour;classement;couple\nev;F;1;A / B\nev;F;x;C / D\n";
    const { rows, errors } = parseResultsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it("ignores unknown columns and keeps the first of duplicated ones", () => {
    const csv =
      "epreuve;tour;classement;couple;couple;commentaire\nev;F;1;Premier;Second;x\n";
    expect(parseResultsCsv(csv).rows[0].participant).toBe("Premier");
  });
});
