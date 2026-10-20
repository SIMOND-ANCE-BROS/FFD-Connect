import { readFileSync } from "fs";
import { join } from "path";
import {
  MAX_CHAIRPERSON_ENTRIES,
  MAX_CHAIRPERSON_TITLE,
  exportLink,
  folderDate,
  parseChairpersonDate,
  parseChairpersonIndex,
} from "./chairperson-index";

const INDEX_URL = new URL(
  "https://chairperson.ddsbagnols.com/resultats/index.php?annee=2026",
);
const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "chairperson-index.html"),
  "utf8",
);

const block = (date: string, href: string, title: string, category = "Cat") =>
  `<div class='resultatsEvent'><div class='date'><p>${date}</p></div>` +
  `<div class='detail'><h4>${category}</h4><a href='${href}'>${title}</a></div></div>`;

describe("TopTurnier list of recent competitions (#801, temporary)", () => {
  it("reads the entries of the (anonymised) list page, in page order", () => {
    const { entries, truncated } = parseChairpersonIndex(FIXTURE, INDEX_URL);
    expect(truncated).toBe(false);
    expect(entries).toEqual([
      {
        date: "2026-10-17",
        title: "Exempleville, 2eme trophée d'automne",
        category: "Ep. à Points, Opens",
        folder: "20261017_exempleville",
        exportUrl:
          "https://chairperson.ddsbagnols.com/resultats/20261017_exempleville/index.htm",
      },
      expect.objectContaining({
        date: "2026-10-17",
        title: "G-P de Fictiveville",
        folder: "20261017Fictiveville",
      }),
      // The block's date wins over a folder named « …00 ».
      expect.objectContaining({
        date: "2026-05-08",
        folder: "20260500_imaginaire",
      }),
      expect.objectContaining({
        date: "2026-05-24",
        category: "Standard",
        folder: "20260524champfrancedim",
      }),
      expect.objectContaining({
        date: "2026-04-18",
        category: "Critérium",
        folder: "20260418stexemplesurmer",
      }),
      // Another site and a path out of /resultats/ are skipped; the query
      // and fragment of a link are dropped.
      expect.objectContaining({
        date: "2026-01-10",
        title: "Rivebelle",
        exportUrl:
          "https://chairperson.ddsbagnols.com/resultats/20260110rivebelle/index.htm",
      }),
    ]);
  });

  it("ignores the menu links, the footer and the scripts", () => {
    const { entries } = parseChairpersonIndex(FIXTURE, INDEX_URL);
    expect(entries.map((e) => e.exportUrl).join(" ")).not.toMatch(
      /index\.php|chairperson\.php|elsewhere|admin/,
    );
  });

  it("falls back on the folder date, else null", () => {
    expect(
      parseChairpersonIndex(
        block("bientôt", "20260314_exempleville/index.htm", "A"),
        INDEX_URL,
      ).entries[0].date,
    ).toBe("2026-03-14");
    expect(
      parseChairpersonIndex(
        block("bientôt", "exempleville/index.htm", "A"),
        INDEX_URL,
      ).entries[0].date,
    ).toBeNull();
  });

  it("skips a block without a title or a usable link", () => {
    const html =
      block("1 jan 26", "20260101_a/index.htm", "") +
      block("1 jan 26", "20260101_a/other.htm", "B") +
      block("1 jan 26", "20260101_a/sub/index.htm", "C") +
      block("1 jan 26", "javascript:alert(1)", "D") +
      block(
        "1 jan 26",
        "http://chairperson.ddsbagnols.com/resultats/x/index.htm",
        "E",
      ) +
      `<div class='resultatsEvent'><p>1 jan 26</p><h4>X</h4></div>`;
    expect(parseChairpersonIndex(html, INDEX_URL).entries).toEqual([]);
  });

  it("keeps the first link of a block and closes a block at its own </div>", () => {
    const html =
      `<div class='resultatsEvent'><div><p>2 jan 26</p></div>` +
      `<a href='20260102_a/index.htm'>Premier</a><a href='20260102_b/index.htm'>Second</a></div>` +
      `<a href='20260103_c/index.htm'>Hors bloc</a>`;
    expect(parseChairpersonIndex(html, INDEX_URL).entries).toEqual([
      expect.objectContaining({ title: "Premier", folder: "20260102_a" }),
    ]);
  });

  it("reads an unclosed last block, and a block nested in another one", () => {
    const html =
      `<div class="x resultatsEvent"><p>3 jan 26</p><a href="20260103_a/index.htm">A</a>` +
      `<div class='resultatsEvent'><p>4 jan 26</p><a href="20260104_b/index.htm">B</a>`;
    expect(
      parseChairpersonIndex(html, INDEX_URL).entries.map((e) => e.title),
    ).toEqual(["A", "B"]);
  });

  it("caps the entries and the title length", () => {
    const many = Array.from({ length: MAX_CHAIRPERSON_ENTRIES + 5 }, (_, i) =>
      block("5 jan 26", `20260105_n${i}/index.htm`, "x".repeat(500)),
    ).join("");
    const { entries, truncated } = parseChairpersonIndex(many, INDEX_URL);
    expect(entries).toHaveLength(MAX_CHAIRPERSON_ENTRIES);
    expect(truncated).toBe(true);
    expect(entries[0].title).toHaveLength(MAX_CHAIRPERSON_TITLE);
  });

  it.each([
    ["17 oct 26", "2026-10-17"],
    ["3 févr. 2026", "2026-02-03"],
    ["07 FEV 26", "2026-02-07"],
    ["1 août 25", "2025-08-01"],
    ["31 dec 25", "2025-12-31"],
    ["30 fev 26", null],
    ["00 mai 26", null],
    ["12 jui 26", null],
    ["12 oct", null],
    ["12 oct 26 extra", null],
    ["123 oct 26", null],
    ["12 oct 1926", null],
  ])("date « %s » → %s", (text, expected) => {
    expect(parseChairpersonDate(text)).toBe(expected);
  });

  it("reads the date of a folder name", () => {
    expect(folderDate("20261017_exempleville")).toBe("2026-10-17");
    expect(folderDate("20260500_exempleville")).toBeNull();
    expect(folderDate("exempleville")).toBeNull();
  });

  it("only links to a direct sub-folder of /resultats/ on the same origin", () => {
    expect(exportLink("20261017_a/index.html", INDEX_URL)?.folder).toBe(
      "20261017_a",
    );
    expect(exportLink("/resultats/x/index.htm", INDEX_URL)?.folder).toBe("x");
    for (const href of [
      "../x/index.htm",
      "./../../x/index.htm",
      "%2e%2e/x/index.htm",
      ".hidden/index.htm",
      "//evil.example/resultats/x/index.htm",
      "https://chairperson.ddsbagnols.com:8443/resultats/x/index.htm",
      "x/index.php",
      "x/y/index.htm",
      "http://[::1/x",
    ]) {
      expect(exportLink(href, INDEX_URL)).toBeNull();
    }
  });
});
