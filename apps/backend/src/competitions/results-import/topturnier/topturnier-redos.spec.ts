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

// Generous on purpose: a backtracking regex costs seconds to minutes here,
// a linear parse a few ms to ~100 ms — 200 ms tripped on a loaded machine
// running the whole suite in parallel.
const BUDGET_MS = 1000;
const SIZE = 200 * 1024;

function timed(run: () => unknown): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const repeat = (piece: string, size = SIZE) =>
  piece.repeat(Math.ceil(size / piece.length));

const ADVERSARIAL: [string, string][] = [
  ["unclosed <td", repeat("<td")],
  ["unclosed <td with attributes", repeat('<td class="x" ')],
  ["<tr><td> without closing tags", repeat("<tr><td>")],
  ["unclosed <a", repeat("<a href=x>")],
  ["<a> without </a>", `<a href="1-x/index.htm">${repeat("<b>")}`],
  ["lone <", repeat("<")],
  ["< without >", repeat("<x ")],
  ["unclosed comment", `<!--${repeat("-")}`],
  ["repeated unclosed comments", repeat("<!--")],
  ["unclosed script", repeat("<script>")],
  ["script with partial closings", `<script>${repeat("</scrip")}`],
  ["unclosed title", repeat("<title>")],
  ["space runs", `<tr><td>1.</td><td>${repeat(" ")}x`],
  ["slash and space runs", `<tr><td>1.</td><td>2</td><td>${repeat(" /  ")}`],
  ["long attribute run", `<td ${repeat("a=b ")}>`],
  ["long href attribute", `<a ${repeat(" href ")}>x</a>`],
  ["entity-like runs", repeat("&#x")],
];

const PARSERS: [string, (html: string) => unknown][] = [
  ["ranking", parseTopTurnierRanking],
  ["index", parseTopTurnierIndex],
  ["title", pageTitle],
  ["text", htmlText],
];

const CASES = ADVERSARIAL.flatMap(([name, html]) =>
  PARSERS.map(([parser, parse]) => [name, parser, html, parse] as const),
);

describe("TopTurnier parsing of adversarial pages (ReDoS)", () => {
  it.each(CASES)(
    "%s (%s): 200 KB parsed under the budget",
    (_name, _parser, html, parse) => {
      expect(timed(() => parse(html))).toBeLessThan(BUDGET_MS);
    },
  );

  it("scales linearly: 8x the input costs far less than 64x the time", () => {
    const small = repeat("<a href=x><tr><td> <b>", 64 * 1024);
    const large = repeat("<a href=x><tr><td> <b>", 8 * 64 * 1024);
    const run = (html: string) => () => {
      parseTopTurnierRanking(html);
      parseTopTurnierIndex(html);
    };
    timed(run(small)); // warm-up
    const ratio = timed(run(large)) / Math.max(timed(run(small)), 1);
    // Linear ≈ 8, quadratic ≈ 64.
    expect(ratio).toBeLessThan(24);
  });

  it("a 2 MB page of open non-result rows stays well under a second", () => {
    const html = repeat("<tr><td>x<td>y<td>", 2 * 1024 * 1024);
    expect(timed(() => parseTopTurnierRanking(html))).toBeLessThan(2_000);
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
