import { parseChairpersonIndex } from "./chairperson-index";
import { placeKey, titleHeadKey } from "./chairperson-match";
import {
  MAX_COLLECTED_TEXT,
  htmlText,
  htmlTokens,
  pageTitle,
} from "./topturnier-html";
import {
  parseTopTurnierIndex,
  parseTopTurnierRanking,
} from "./topturnier.parser";

/**
 * The pages of an export are untrusted (uploaded, or fetched for #787) and
 * up to 2 MB: parsing must stay linear whatever they contain. The former
 * regexes (`<a\b([^>]*)>([\s\S]*?)<\/a\s*>`, `<[^>]*>`, `<!--[\s\S]*?-->`,
 * `\s*\/\s*`…) rescanned the rest of the page from every start position when
 * the terminator was missing: seconds to minutes of CPU per page.
 */

// Timing a parse against a fixed budget failed whenever the machine was busy
// (#807): other processes competing for the cores stretch every wall-clock
// measurement. These tests compare the parser with itself instead:
// - they time the CPU of this process (`process.cpuUsage`), which the other
//   processes do not inflate;
// - they parse the same input at two sizes, GROWTH_FACTOR apart, interleaved,
//   keeping the fastest of RUNS runs, so a GC pause or a burst of load spoils
//   one sample, not the verdict;
// - a linear parse grows ~8x between the two sizes, a backtracking one ~64x
//   or more: the growth must stay under MAX_GROWTH, far from both.
const SIZE = 200 * 1024;
const GROWTH_FACTOR = 8;
const MAX_GROWTH = 24;
const RUNS = 3;
// Below this a duration is timer and scheduler noise, not parsing work. It
// cannot hide a backtracking parser: none parses the large input in under
// MAX_GROWTH * NOISE_FLOOR_MS (12 ms) — a quadratic rescan of 200 KB is
// ~2e10 steps.
const NOISE_FLOOR_MS = 0.5;

function cpuMs(run: () => unknown): number {
  const start = process.cpuUsage();
  run();
  const { user, system } = process.cpuUsage(start);
  return (user + system) / 1000;
}

/**
 * How much more CPU `parse` needs for an input GROWTH_FACTOR times larger:
 * ~GROWTH_FACTOR when linear, ~GROWTH_FACTOR² when quadratic.
 */
function growth(
  parse: (input: string) => unknown,
  makeInput: (size: number) => string,
  size = SIZE,
): number {
  const small = makeInput(size / GROWTH_FACTOR);
  const large = makeInput(size);
  parse(small); // warm-up: let V8 compile the parser before timing it
  let smallMs = Infinity;
  let largeMs = Infinity;
  for (let i = 0; i < RUNS; i++) {
    smallMs = Math.min(
      smallMs,
      cpuMs(() => parse(small)),
    );
    largeMs = Math.min(
      largeMs,
      cpuMs(() => parse(large)),
    );
  }
  return largeMs / Math.max(smallMs, NOISE_FLOOR_MS);
}

const repeat = (piece: string, size: number) =>
  piece.repeat(Math.ceil(size / piece.length));

const ADVERSARIAL: [string, (size: number) => string][] = [
  ["unclosed <td", (n) => repeat("<td", n)],
  ["unclosed <td with attributes", (n) => repeat('<td class="x" ', n)],
  ["<tr><td> without closing tags", (n) => repeat("<tr><td>", n)],
  ["unclosed <a", (n) => repeat("<a href=x>", n)],
  ["<a> without </a>", (n) => `<a href="1-x/index.htm">${repeat("<b>", n)}`],
  ["lone <", (n) => repeat("<", n)],
  ["< without >", (n) => repeat("<x ", n)],
  ["unclosed comment", (n) => `<!--${repeat("-", n)}`],
  ["repeated unclosed comments", (n) => repeat("<!--", n)],
  ["unclosed script", (n) => repeat("<script>", n)],
  ["script with partial closings", (n) => `<script>${repeat("</scrip", n)}`],
  ["unclosed title", (n) => repeat("<title>", n)],
  ["space runs", (n) => `<tr><td>1.</td><td>${repeat(" ", n)}x`],
  [
    "slash and space runs",
    (n) => `<tr><td>1.</td><td>2</td><td>${repeat(" /  ", n)}`,
  ],
  ["long attribute run", (n) => `<td ${repeat("a=b ", n)}>`],
  ["long href attribute", (n) => `<a ${repeat(" href ", n)}>x</a>`],
  ["entity-like runs", (n) => repeat("&#x", n)],
  // List of recent competitions (#801).
  ["unclosed result blocks", (n) => repeat("<div class='resultatsEvent'>", n)],
  [
    "blocks with unclosed captures",
    (n) =>
      repeat("<div class='resultatsEvent'><p><h4><a href='x/index.htm'>", n),
  ],
  [
    "deep div nesting",
    (n) => `${repeat("<div>", n / 2)}${repeat("</div>", n / 2)}`,
  ],
  [
    "long class attribute",
    (n) => `<div class='${repeat("resultatsEvent ", n)}'>`,
  ],
  [
    "long href of a block",
    (n) =>
      `<div class='resultatsEvent'><a href='${repeat("../", n)}index.htm'>x</a>`,
  ],
  [
    "long date text",
    (n) => `<div class='resultatsEvent'><p>${repeat("17 oct ", n)}</p>`,
  ],
];

const INDEX_URL = new URL(
  "https://chairperson.ddsbagnols.com/resultats/index.php?annee=2026",
);

const PARSERS: [string, (html: string) => unknown][] = [
  ["ranking", parseTopTurnierRanking],
  ["index", parseTopTurnierIndex],
  ["title", pageTitle],
  ["text", htmlText],
  ["chairperson list", (html) => parseChairpersonIndex(html, INDEX_URL)],
];

const CASES = ADVERSARIAL.flatMap(([name, makeInput]) =>
  PARSERS.map(([parser, parse]) => [name, parser, makeInput, parse] as const),
);

describe("TopTurnier parsing of adversarial pages (ReDoS)", () => {
  it.each(CASES)(
    "%s (%s): parsing time grows linearly up to 200 KB",
    (_name, _parser, makeInput, parse) => {
      expect(growth(parse, makeInput)).toBeLessThan(MAX_GROWTH);
    },
  );

  it("scales linearly on a mix of open tags", () => {
    const parse = (html: string) => {
      parseTopTurnierRanking(html);
      parseTopTurnierIndex(html);
    };
    const makeInput = (n: number) => repeat("<a href=x><tr><td> <b>", n);
    expect(growth(parse, makeInput, 512 * 1024)).toBeLessThan(MAX_GROWTH);
  });

  it("scales linearly on the list of recent competitions (#801)", () => {
    const piece =
      "<div class='resultatsEvent'><p>1 jan 26</p><a href='20260101_a/index.htm'>A</a></div>";
    const parse = (html: string) => parseChairpersonIndex(html, INDEX_URL);
    const makeInput = (n: number) => repeat(piece, n);
    expect(growth(parse, makeInput, 512 * 1024)).toBeLessThan(MAX_GROWTH);
  });

  it("compares place names in linear time (#801)", () => {
    const makeInput = (n: number) =>
      `${"saint ".repeat(n / 6)}-${"é".repeat(n)}`;
    expect(growth(placeKey, makeInput)).toBeLessThan(MAX_GROWTH);
    expect(growth(titleHeadKey, makeInput)).toBeLessThan(MAX_GROWTH);
  });

  it("parses up to a 2 MB page of open non-result rows in linear time", () => {
    const makeInput = (n: number) => repeat("<tr><td>x<td>y<td>", n);
    expect(
      growth(parseTopTurnierRanking, makeInput, 2 * 1024 * 1024),
    ).toBeLessThan(MAX_GROWTH);
  });

  it("caps a collected text, keeping it longer than any accepted field", () => {
    const huge = `<tr><td>1.</td><td>7</td><td>${"x".repeat(50_000)}</td></tr>`;
    const ranking = parseTopTurnierRanking(huge);
    expect(ranking.rows).toHaveLength(0);
    expect(ranking.errors[0].message).toContain("trop long");
    expect(
      htmlText("y".repeat(MAX_COLLECTED_TEXT * 2)).length,
    ).toBeLessThanOrEqual(MAX_COLLECTED_TEXT);
  });

  it("tokenizes tags, text and dropped constructs", () => {
    expect([
      ...htmlTokens('a<!--c-->b<TD Class="x">c</td><script>x</SCRIPT>d < e'),
    ]).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: " " },
      { kind: "text", text: "b" },
      { kind: "tag", name: "td", closing: false, raw: '<TD Class="x">' },
      { kind: "text", text: "c" },
      { kind: "tag", name: "td", closing: true, raw: "</td>" },
      { kind: "text", text: " " },
      { kind: "text", text: "d " },
      { kind: "text", text: "<" },
      { kind: "text", text: " e" },
    ]);
  });

  it("stops at an unterminated construct, like a browser", () => {
    expect(htmlText("a<b")).toBe("a");
    expect(htmlText("a<!-- b")).toBe("a");
    expect(htmlText("a<script>b")).toBe("a");
    expect(pageTitle("<title>never closed")).toBeNull();
  });

  it("still reads a row whose table is not closed", () => {
    const ranking = parseTopTurnierRanking(
      "<table><tr><td>1.</td><td>5</td><td>A B  /  C D</td><td>Club</td>",
    );
    expect(ranking.rows).toEqual([
      expect.objectContaining({
        ranking: 1,
        bib: "5",
        participant: "A B / C D",
      }),
    ]);
  });
});
