import { readFileSync } from "fs";
import { join } from "path";
import { EXEMPLEVILLE_EXPORT } from "./__fixtures__/zip-builder";
import {
  decodeEntities,
  decodePage,
  htmlText,
  pageTitle,
  attributeValue,
} from "./topturnier-html";
import {
  TOPTURNIER_MAX_EVENTS,
  TOPTURNIER_MAX_ROWS_PER_EVENT,
  TopTurnierFormatError,
  eventFolderOf,
  parseRankCell,
  parseTopTurnierIndex,
  parseTopTurnierRanking,
} from "./topturnier.parser";

const page = (path: string) =>
  decodePage(readFileSync(join(EXEMPLEVILLE_EXPORT, path)));

describe("topturnier-html", () => {
  it("decodes numeric, hex and named entities", () => {
    expect(
      decodeEntities("Comp&#233;tition &#xE0; &eacute;t&eacute; &amp; co"),
    ).toBe("Compétition à été & co");
    expect(decodeEntities("&unknown; &#0; &#1;")).toBe("&unknown;   ");
  });

  it("extracts the visible text of a fragment", () => {
    expect(
      htmlText(
        "<i>Club</i><!-- c --><script>alert(1)</script><br/>  Danse&nbsp;&#233;",
      ),
    ).toBe("Club Danse é");
  });

  it("reads attributes quoted or not, and the title", () => {
    expect(attributeValue('<a href="x/index.htm">', "href")).toBe(
      "x/index.htm",
    );
    expect(attributeValue("<a href='y'>", "href")).toBe("y");
    expect(attributeValue("<a href=z>", "href")).toBe("z");
    expect(attributeValue("<a>", "href")).toBeNull();
    expect(pageTitle("<title>A &#224; B</title>")).toBe("A à B");
    expect(pageTitle("<p>none</p>")).toBeNull();
  });

  it("decodes UTF-8 (with or without BOM) and windows-1252 pages", () => {
    expect(decodePage(Buffer.from("﻿é", "utf8"))).toBe("é");
    expect(decodePage(Buffer.from("<p>é</p>", "utf8"))).toBe("<p>é</p>");
    // Undeclared latin-1 bytes: not valid UTF-8 → windows-1252.
    expect(decodePage(Buffer.from([0x3c, 0x70, 0x3e, 0xe9]))).toBe("<p>é");
    expect(page("60-xyz_mystery/erg.htm")).toContain("Équipe Fictive");
  });
});

describe("parseTopTurnierIndex", () => {
  it("lists the events of the competition page, in order, once each", () => {
    const index = parseTopTurnierIndex(page("index.htm"));
    expect(index.title).toBe(
      "Compétition nationale à Exempleville vom 01.02.2026 in EXEMPLEVILLE",
    );
    expect(index.events).toEqual([
      { folder: "3-nat_adultsavancelat", label: "Nat, Adults Avancé Latin" },
      {
        folder: "8-nat_sen2intermediairestd",
        label: "Nat, Sen.II Intermédiaire Standard",
      },
      {
        folder: "19-nat_youthadultsdebutantlat",
        label: "Nat, Youth/Adults Débutant Latin",
      },
      { folder: "25-oc_youthadultslat", label: "OC, Youth/Adults Latin" },
      { folder: "27-oc_seni2std", label: "OC, Sen.I/II Standard" },
      {
        folder: "47-nat_solosjuni2debutantlat",
        label: "Nat, Solos Jun.I/II Débutant Latin",
      },
      { folder: "60-xyz_mystery", label: "Gala, Formation Show" },
    ]);
  });

  it("refuses more events than the limit", () => {
    const links = Array.from(
      { length: TOPTURNIER_MAX_EVENTS + 1 },
      (_, i) => `<a href="${i}-e/index.htm">E${i}</a>`,
    ).join("");
    expect(() => parseTopTurnierIndex(links)).toThrow(TopTurnierFormatError);
  });

  it("ignores links without a label", () => {
    expect(
      parseTopTurnierIndex('<a href="1-e/index.htm"> </a>').events,
    ).toEqual([]);
  });

  it.each([
    ["3-nat_x/index.htm", "3-nat_x"],
    ["./3-nat_x/index.html", "3-nat_x"],
    ["3-nat_x/", "3-nat_x"],
  ])("reads the event folder of %s", (href, folder) => {
    expect(eventFolderOf(href)).toBe(folder);
  });

  it.each([
    "../index.htm",
    "http://www.TopTurnier.de",
    "topturnier.css",
    "a/b/index.htm",
    "a..b/index.htm",
    "/abs/index.htm",
    "x/erg.htm",
  ])("ignores the link %s", (href) => {
    expect(eventFolderOf(href)).toBeNull();
  });
});

describe("parseRankCell", () => {
  it.each([
    ["1.", 1, 1],
    ["12", 12, 12],
    ["1.-2.", 1, 2],
    ["7. - 12.", 7, 12],
  ])("reads %s", (cell, from, to) => {
    expect(parseRankCell(cell)).toEqual({ from, to });
  });

  it.each(["", "Final", "0.", "3.-2.", "1.2.", "-1"])("refuses %j", (cell) => {
    expect(parseRankCell(cell)).toBeNull();
  });
});

describe("parseTopTurnierRanking", () => {
  it("reads a couple ranking (English header)", () => {
    const ranking = parseTopTurnierRanking(
      page("3-nat_adultsavancelat/erg.htm"),
    );
    expect(ranking.errors).toEqual([]);
    expect(ranking.rows).toEqual([
      {
        position: 1,
        ranking: 1,
        rankingTo: 1,
        bib: "22",
        participant: "Alice MARTIN / Bruno DURAND",
        club: "Club Exemple A",
      },
      {
        position: 2,
        ranking: 2,
        rankingTo: 2,
        bib: "23",
        participant: "Chloé PETIT / David LÉGER",
        club: "Club Exemple B",
      },
      {
        position: 3,
        ranking: 3,
        rankingTo: 3,
        bib: "17",
        participant: "Emma ROUX / Fabien NOIR",
        club: "Club Exemple A",
      },
    ]);
  });

  it("reads a German header, several tables and a tie", () => {
    const ranking = parseTopTurnierRanking(
      page("8-nat_sen2intermediairestd/erg.htm"),
    );
    expect(ranking.errors).toEqual([]);
    expect(
      ranking.rows.map((r) => [r.ranking, r.rankingTo, r.bib, r.club]),
    ).toEqual([
      [1, 1, "101", "Danse Club Fictif"],
      [2, 2, "102", "Danse Club Fictif"],
      [3, 4, "103", "Club & Danse"],
      [3, 4, "104", "Club Exemple B"],
    ]);
  });

  it("reads a solo ranking (one name)", () => {
    const ranking = parseTopTurnierRanking(
      page("47-nat_solosjuni2debutantlat/erg.htm"),
    );
    expect(ranking.rows.map((r) => r.participant)).toEqual([
      "Sarah TITANE",
      "Théa COBALT",
    ]);
  });

  it("reports a malformed row with its position", () => {
    const ranking = parseTopTurnierRanking(page("27-oc_seni2std/erg.htm"));
    expect(ranking.rows).toHaveLength(1);
    expect(ranking.errors).toEqual([
      { position: 2, message: "couple manquant" },
    ]);
  });

  it("reports a page without ranking rows", () => {
    expect(parseTopTurnierRanking("<html><p>Bientôt</p></html>")).toEqual({
      rows: [],
      errors: [{ position: 0, message: "aucune ligne de classement" }],
    });
  });

  it("reads a table without header positionally", () => {
    const ranking = parseTopTurnierRanking(
      "<table><tr><td>1.</td><td>5</td><td>A / B</td><td>C</td></tr></table>",
    );
    expect(ranking.rows[0]).toMatchObject({
      bib: "5",
      participant: "A / B",
      club: "C",
    });
  });

  it("follows the header column order, without bib or club", () => {
    const ranking = parseTopTurnierRanking(
      "<table><tr><th>Couple</th><th>Place</th></tr><tr><td>A / B</td><td>2.</td></tr></table>",
    );
    expect(ranking.rows[0]).toMatchObject({
      ranking: 2,
      participant: "A / B",
      bib: null,
      club: null,
    });
  });

  it("refuses an invalid bib and too long fields", () => {
    const long = "x".repeat(201);
    const ranking = parseTopTurnierRanking(
      `<table><tr><td>1.</td><td>&lt;b&gt;</td><td>A</td><td></td></tr><tr><td>2.</td><td>2</td><td>${long}</td><td>${long}</td></tr></table>`,
    );
    expect(ranking.errors).toEqual([
      { position: 1, message: "dossard invalide" },
      { position: 2, message: "libellé du couple trop long, club trop long" },
    ]);
  });

  it("refuses more rows than the limit", () => {
    const rows = Array.from(
      { length: TOPTURNIER_MAX_ROWS_PER_EVENT + 1 },
      (_, i) =>
        `<tr><td>${i + 1}.</td><td>${i}</td><td>P${i}</td><td>C</td></tr>`,
    ).join("");
    expect(() => parseTopTurnierRanking(`<table>${rows}</table>`)).toThrow(
      TopTurnierFormatError,
    );
  });
});
